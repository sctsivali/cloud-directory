import { Pool } from "pg";

const globalForPg = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL || "postgres://arena:arena_dev@db:5432/arena",
  });

if (!globalForPg.pool) globalForPg.pool = pool;

const ASEAN = `'Indonesia','Malaysia','Singapore','Thailand','Vietnam','Philippines','Cambodia','Laos','Myanmar','Brunei'`;

const CITY_NAMED = `
  btrim(COALESCE(%CITY%,'')) <> ''
  AND btrim(%CITY%) !~* '^(undisclosed|unknown|not disclosed)'
`;

const SOV = `
  (
    CASE WHEN EXISTS (
      SELECT 1 FROM tiers tx
      WHERE tx.provider_id = p.id
        AND tx.status = 'OK'
        AND ${CITY_NAMED.replaceAll("%CITY%", "tx.dc_city")}
        AND COALESCE(tx.dc_country,'') IN (${ASEAN})
    ) OR EXISTS (
      SELECT 1 FROM provider_locations pl
      JOIN locations l ON l.id = pl.location_id
      WHERE pl.provider_id = p.id
        AND ${CITY_NAMED.replaceAll("%CITY%", "l.city")}
        AND l.country IN (${ASEAN})
    ) THEN 40 ELSE 0 END
    + CASE WHEN COALESCE(NULLIF(p.legal_country,''), p.hq_country, '') IN (${ASEAN})
      THEN 25 ELSE 0 END
    + CASE WHEN COALESCE(p.legal_country,'') IN (${ASEAN}) AND EXISTS (
        SELECT 1 FROM tiers tx
        WHERE tx.provider_id = p.id
          AND tx.status = 'OK'
          AND ${CITY_NAMED.replaceAll("%CITY%", "tx.dc_city")}
          AND tx.dc_country = p.legal_country
      ) THEN 15 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM provider_buildings pb
        JOIN buildings b ON b.id = pb.building_id
        WHERE pb.provider_id = p.id AND b.listed
      ) THEN 20 ELSE 0 END
  )
`;

const CONF = `
  (
    CASE WHEN COALESCE(p.hq_country,'') <> '' THEN 20 ELSE 0 END
    + CASE
        WHEN btrim(COALESCE(st.hypervisor,'')) = '' THEN 0
        WHEN COALESCE(st.hypervisor,'') ~* 'likely|implied|typical|unknown|confirmed:|not disclosed|belum ditemukan|sales model|derived' THEN 0
        WHEN length(btrim(st.hypervisor)) > 60 THEN 0
        ELSE 20
      END
    + CASE WHEN EXISTS (
        SELECT 1 FROM provider_buildings pb
        JOIN buildings b ON b.id = pb.building_id
        WHERE pb.provider_id = p.id AND b.listed
      ) THEN 15 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM tiers tx
        WHERE tx.provider_id = p.id
          AND COALESCE(tx.dc_country,'') <> ''
          AND ${CITY_NAMED.replaceAll("%CITY%", "tx.dc_city")}
      ) THEN 15 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM sources so
        WHERE so.provider_id = p.id AND COALESCE(so.url,'') <> ''
      ) THEN 15 ELSE 0 END
    + CASE WHEN COALESCE(p.legal_country,'') <> '' THEN 15 ELSE 0 END
  )
`;

export type OverviewProvider = {
  id: string;
  name: string;
  hq_country: string | null;
  legal_country: string | null;
  legal_note: string | null;
  origin: string | null;
  is_local_asean: boolean;
  data_residency: string | null;
  hypervisor: string | null;
  tier_count: number;
  min_price: number | null;
  sov_score: number;
  conf_score: number;
};

export type OverviewCity = {
  city: string;
  country: string;
  providers: number;
};

export type OverviewData = {
  providerCount: number;
  localCount: number;
  tierCount: number;
  cityCount: number;
  ossCount: number;
  buildingCount: number;
  topLocal: OverviewProvider[];
  cities: OverviewCity[];
};

export async function getOverview(): Promise<OverviewData> {
  const [counts, top, cities] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM providers) AS providers,
        (SELECT COUNT(*)::int FROM providers WHERE is_local_asean) AS local,
        (SELECT COUNT(*)::int FROM tiers) AS tiers,
        (SELECT COUNT(*)::int FROM locations) AS cities,
        (SELECT COUNT(*)::int FROM buildings WHERE listed) AS buildings,
        (SELECT COUNT(*)::int FROM stacks
          WHERE open_source IS TRUE
             OR COALESCE(hypervisor,'') ~* 'kvm|proxmox|xen|openstack') AS oss
    `),
    pool.query<OverviewProvider>(`
      SELECT
        p.id, p.name, p.hq_country, p.legal_country, p.legal_note, p.origin, p.is_local_asean,
        s.data_residency, st.hypervisor,
        COUNT(t.id)::int AS tier_count,
        MIN(t.price_usd_month) FILTER (WHERE t.status = 'OK')::float AS min_price,
        ${SOV}::int AS sov_score,
        ${CONF}::int AS conf_score
      FROM providers p
      LEFT JOIN sovereignty s ON s.provider_id = p.id
      LEFT JOIN stacks st ON st.provider_id = p.id
      LEFT JOIN tiers t ON t.provider_id = p.id
      WHERE p.is_local_asean
      GROUP BY p.id, s.data_residency, st.hypervisor, st.source_url
      ORDER BY ${SOV} DESC, p.name
    `),
    pool.query<OverviewCity>(`
      SELECT COALESCE(NULLIF(t.dc_city,''), t.dc_location) AS city,
             t.dc_country AS country,
             COUNT(DISTINCT t.provider_id)::int AS providers
      FROM tiers t
      WHERE t.dc_country IN ('Indonesia','Vietnam','Malaysia','Thailand','Singapore','Philippines')
      GROUP BY 1, 2
      ORDER BY providers DESC, city
      LIMIT 8
    `),
  ]);
  const c = counts.rows[0];
  return {
    providerCount: c.providers,
    localCount: c.local,
    tierCount: c.tiers,
    cityCount: c.cities,
    ossCount: c.oss,
    buildingCount: c.buildings,
    topLocal: top.rows,
    cities: cities.rows,
  };
}

export type ArenaRow = OverviewProvider & {
  loc_count: number;
  oss_score: number;
  max_vcpu: number | null;
  max_ram: number | null;
  orchestration: string | null;
  storage: string | null;
  container_runtime: string | null;
  control_plane: string | null;
};

export async function getArena(): Promise<ArenaRow[]> {
  const { rows } = await pool.query<ArenaRow>(`
    SELECT
      p.id, p.name, p.hq_country, p.legal_country, p.legal_note, p.origin, p.is_local_asean,
      s.data_residency, st.hypervisor, st.orchestration, st.storage, st.container_runtime, st.control_plane,
      COUNT(DISTINCT t.id)::int AS tier_count,
      MIN(t.price_usd_month) FILTER (WHERE t.status = 'OK')::float AS min_price,
      COUNT(DISTINCT pl.location_id)::int AS loc_count,
      MAX(t.vcpu)::int AS max_vcpu,
      MAX(t.ram_gb)::float AS max_ram,
      ${SOV}::int AS sov_score,
      ${CONF}::int AS conf_score,
      (
        CASE WHEN COALESCE(st.hypervisor,'') ~* 'kvm|proxmox|xen' THEN 30 ELSE 0 END
        + CASE WHEN COALESCE(st.orchestration,'') ~* 'kubernetes|k8s|docker' THEN 20 ELSE 0 END
        + CASE WHEN COALESCE(st.storage,'') ~* 'ceph|openebs|longhorn|rook' THEN 20 ELSE 0 END
        + CASE WHEN st.open_source IS TRUE THEN 15 ELSE 0 END
        + CASE WHEN COALESCE(st.control_plane,'') ~* 'proxmox|openstack' THEN 15 ELSE 0 END
      )::int AS oss_score
    FROM providers p
    LEFT JOIN sovereignty s ON s.provider_id = p.id
    LEFT JOIN stacks st ON st.provider_id = p.id
    LEFT JOIN tiers t ON t.provider_id = p.id
    LEFT JOIN provider_locations pl ON pl.provider_id = p.id
    GROUP BY p.id, s.data_residency, st.hypervisor, st.orchestration, st.storage, st.container_runtime, st.control_plane, st.open_source, st.source_url
    ORDER BY p.is_local_asean DESC, p.name
  `);
  return rows;
}

export type ProviderDetail = {
  id: string;
  name: string;
  hq_country: string | null;
  legal_country: string | null;
  legal_note: string | null;
  origin: string | null;
  is_local_asean: boolean;
  provider_type: string | null;
  data_residency: string | null;
  sea_strength: string | null;
  hypervisor: string | null;
  orchestration: string | null;
  storage: string | null;
  control_plane: string | null;
  virtualization: string | null;
  open_source: boolean | null;
  source_url: string | null;
  sov_score: number;
  oss_score: number;
  conf_score: number;
  cities: { id: number | null; city: string; country: string; building: string; listed: boolean; address: string | null; operator: string | null }[];
  sources: { url: string; status: string | null }[];
  tiers: {
    id: string;
    tier_name: string;
    vcpu: number | null;
    ram_gb: number | null;
    storage_gb: number | null;
    storage_type: string | null;
    cpu_family: string | null;
    price_native: string | null;
    currency: string | null;
    price_usd_month: number;
    dc_location: string | null;
    dc_city: string | null;
    dc_country: string | null;
    hypervisor: string | null;
    orchestration: string | null;
    container_runtime: string | null;
    stack_storage: string | null;
    sov_score: number | null;
    oss_score: number | null;
  }[];
};

export async function getProvider(id: string): Promise<ProviderDetail | null> {
  const { rows } = await pool.query(
    `
    SELECT
      p.id, p.name, p.hq_country, p.legal_country, p.legal_note, p.origin, p.is_local_asean, p.provider_type,
      s.data_residency, s.sea_strength,
      st.hypervisor, st.orchestration, st.storage, st.control_plane, st.virtualization, st.open_source, st.source_url,
      ${SOV}::int AS sov_score,
      ${CONF}::int AS conf_score,
      (
        CASE WHEN COALESCE(st.hypervisor,'') ~* 'kvm|proxmox|xen' THEN 30 ELSE 0 END
        + CASE WHEN COALESCE(st.orchestration,'') ~* 'kubernetes|k8s|docker' THEN 20 ELSE 0 END
        + CASE WHEN COALESCE(st.storage,'') ~* 'ceph|openebs|longhorn|rook' THEN 20 ELSE 0 END
        + CASE WHEN st.open_source IS TRUE THEN 15 ELSE 0 END
        + CASE WHEN COALESCE(st.control_plane,'') ~* 'proxmox|openstack' THEN 15 ELSE 0 END
      )::int AS oss_score
    FROM providers p
    LEFT JOIN sovereignty s ON s.provider_id = p.id
    LEFT JOIN stacks st ON st.provider_id = p.id
    WHERE p.id = $1
    `,
    [id]
  );
  if (!rows[0]) return null;
  const p = rows[0];
  const [locs, tiers, srcs] = await Promise.all([
    pool.query(
      `SELECT * FROM (
         SELECT b.id, b.city, b.country, b.name AS building, b.listed, b.address, b.operator
         FROM provider_buildings pb
         JOIN buildings b ON b.id = pb.building_id
         WHERE pb.provider_id = $1 AND b.listed
         UNION ALL
         SELECT NULL::int AS id, l.city, l.country, 'Undisclosed building' AS building,
                FALSE AS listed, NULL::text AS address, NULL::text AS operator
         FROM provider_locations pl
         JOIN locations l ON l.id = pl.location_id
         WHERE pl.provider_id = $1
           AND NOT EXISTS (
             SELECT 1
             FROM provider_buildings pb2
             JOIN buildings b2 ON b2.id = pb2.building_id AND b2.listed
             WHERE pb2.provider_id = $1 AND b2.city = l.city AND b2.country = l.country
           )
       ) loc
       ORDER BY listed DESC, country, city, building`,
      [id]
    ),
    pool.query(
      `SELECT id, tier_name, vcpu, ram_gb, storage_gb, storage_type, cpu_family,
              price_native, currency, price_usd_month, dc_location, dc_city, dc_country,
              hypervisor, orchestration, container_runtime, stack_storage,
              sov_score, oss_score
       FROM tiers WHERE provider_id = $1 AND status = 'OK'
       ORDER BY price_usd_month NULLS LAST, vcpu NULLS LAST
       LIMIT 40`,
      [id]
    ),
    pool.query(
      `SELECT url, status FROM sources
       WHERE provider_id = $1 AND url IS NOT NULL
       ORDER BY id`,
      [id]
    ),
  ]);
  return {
    ...p,
    cities: locs.rows,
    sources: srcs.rows,
    tiers: tiers.rows,
  };
}

export type BuildingRow = {
  id: number;
  name: string;
  city: string;
  country: string;
  listed: boolean;
  address: string | null;
  operator: string | null;
  photo_path: string | null;
  photo_credit: string | null;
  photo_source: string | null;
  provider_count: number;
};

export async function getBuildings(): Promise<BuildingRow[]> {
  const { rows } = await pool.query<BuildingRow>(`
    SELECT
      b.id, b.name, b.city, b.country, b.listed, b.address, b.operator,
      b.photo_path, b.photo_credit, b.photo_source,
      COUNT(DISTINCT pb.provider_id)::int AS provider_count
    FROM buildings b
    LEFT JOIN provider_buildings pb ON pb.building_id = b.id
    WHERE b.listed
    GROUP BY b.id
    ORDER BY b.listed DESC, provider_count DESC, b.country, b.city, b.name
  `);
  return rows;
}

export type BuildingDetail = BuildingRow & {
  source: string | null;
  providers: { id: string; name: string; is_local_asean: boolean; hq_country: string | null }[];
};

export async function getBuilding(id: number): Promise<BuildingDetail | null> {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.city, b.country, b.listed, b.address, b.operator, b.source,
            b.photo_path, b.photo_credit, b.photo_source,
            COUNT(DISTINCT pb.provider_id)::int AS provider_count
     FROM buildings b
     LEFT JOIN provider_buildings pb ON pb.building_id = b.id
     WHERE b.id = $1
     GROUP BY b.id`,
    [id]
  );
  if (!rows[0]) return null;
  const { rows: providers } = await pool.query(
    `SELECT p.id, p.name, p.is_local_asean, p.hq_country
     FROM provider_buildings pb
     JOIN providers p ON p.id = pb.provider_id
     WHERE pb.building_id = $1
     ORDER BY p.is_local_asean DESC, p.name`,
    [id]
  );
  return { ...rows[0], providers };
}

export type MapLink = {
  provider_id: string;
  name: string;
  is_local_asean: boolean;
  hq_country: string | null;
  city: string;
  country: string;
  sov_score: number;
};

export async function getMapLinks(): Promise<MapLink[]> {
  const { rows } = await pool.query<MapLink>(`
    SELECT
      p.id AS provider_id, p.name, p.is_local_asean, p.hq_country,
      l.city, l.country,
      ${SOV}::int AS sov_score
    FROM providers p
    JOIN provider_locations pl ON pl.provider_id = p.id
    JOIN locations l ON l.id = pl.location_id
    LEFT JOIN sovereignty s ON s.provider_id = p.id
    LEFT JOIN stacks st ON st.provider_id = p.id
  `);
  return rows;
}

export type TechProvider = {
  id: string;
  name: string;
  hq_country: string | null;
  is_local_asean: boolean;
  hypervisor: string | null;
  orchestration: string | null;
  storage: string | null;
  container_runtime: string | null;
  control_plane: string | null;
  virtualization: string | null;
  plan_count: number;
  min_price: number | null;
};

export type TechPlan = {
  id: string;
  provider_id: string;
  provider_name: string;
  tier_name: string;
  vcpu: number | null;
  ram_gb: number | null;
  price_usd_month: number;
};

export async function getStacks(): Promise<TechProvider[]> {
  const { rows } = await pool.query<TechProvider>(`
    SELECT
      p.id, p.name, p.hq_country, p.is_local_asean,
      st.hypervisor, st.orchestration, st.storage,
      st.container_runtime, st.control_plane, st.virtualization,
      COUNT(t.id)::int AS plan_count,
      MIN(t.price_usd_month)::float AS min_price
    FROM providers p
    LEFT JOIN stacks st ON st.provider_id = p.id
    LEFT JOIN tiers t ON t.provider_id = p.id
    GROUP BY p.id, st.hypervisor, st.orchestration, st.storage,
             st.container_runtime, st.control_plane, st.virtualization
    ORDER BY p.is_local_asean DESC, p.name
  `);
  return rows;
}

export async function getPlansForProviders(ids: string[]): Promise<TechPlan[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<TechPlan>(
    `SELECT t.id, t.provider_id, p.name AS provider_name, t.tier_name,
            t.vcpu, t.ram_gb, t.price_usd_month
     FROM tiers t
     JOIN providers p ON p.id = t.provider_id
     WHERE t.provider_id = ANY($1) AND t.status = 'OK'
     ORDER BY t.price_usd_month NULLS LAST, t.vcpu NULLS LAST`,
    [ids]
  );
  return rows;
}

export type MapSite = {
  id: number;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  provider_ids: string[];
};

export async function getMapSites(): Promise<MapSite[]> {
  const { rows } = await pool.query<MapSite>(`
    SELECT
      b.id, b.name, b.city, b.country, b.lat, b.lng,
      COALESCE(array_agg(DISTINCT pb.provider_id) FILTER (WHERE pb.provider_id IS NOT NULL), '{}') AS provider_ids
    FROM buildings b
    LEFT JOIN provider_buildings pb ON pb.building_id = b.id
    WHERE b.listed AND b.lat IS NOT NULL AND b.lng IS NOT NULL
    GROUP BY b.id
    ORDER BY b.country, b.city, b.name
  `);
  return rows;
}

export type DirectoryUpdate = {
  id: number;
  kind: "discovered" | "updated";
  provider_id: string | null;
  title_id: string;
  title_en: string;
  summary_id: string | null;
  summary_en: string | null;
  href: string | null;
  occurred_at: string;
};

export async function getDirectoryUpdates(): Promise<DirectoryUpdate[]> {
  const { rows } = await pool.query<DirectoryUpdate>(`
    SELECT id, kind, provider_id, title_id, title_en, summary_id, summary_en, href,
           occurred_at::text AS occurred_at
    FROM directory_updates
    ORDER BY occurred_at DESC, id DESC
    LIMIT 80
  `);
  return rows;
}
