import { Pool } from "pg";
import { CURRENT_METHODOLOGY, LEGACY_FALLBACK_LABEL } from "../../../packages/domain/src/scoring/index.ts";
import {
  selectPublicUpdates,
  type LegacyDirectoryUpdate,
  type PublicDirectoryUpdate,
} from "../../../packages/domain/src/revisions/public-feed.ts";
import type { ChangeEvent } from "../../../packages/domain/src/revisions/types.ts";
import { LEGACY_CONF_SQL, LEGACY_OSS_SQL, LEGACY_SOV_SQL } from "./legacy-scoring";
import {
  buildCountryTimeline,
  buildOutlook,
  buildProviderTimeline,
  buildTrendReport,
  factsFromLedgerRows,
  inferObservationWindow,
  ledgerFactRowFromJoin,
  publicOutlookEligibilityView,
  publicTrendView,
  requireRegisteredIso2,
  windowFromInferred,
  MAX_TREND_FACTS,
  type TrendMetric,
  type VerifiedFact,
} from "../../../packages/domain/src/intelligence/index.ts";
import { projectPublicTimelineDocument } from "../../../packages/domain/src/revisions/public-projection.ts";

const globalForPg = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL || "postgres://arena:arena_dev@db:5432/arena",
  });

if (!globalForPg.pool) globalForPg.pool = pool;

const SOV = LEGACY_SOV_SQL;
const CONF = LEGACY_CONF_SQL;
const OSS = LEGACY_OSS_SQL;

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

export type ScoreEngineMeta = {
  score_engine: "canonical" | "legacy-fallback";
  algorithm_version: string;
  ruleset_hash: string;
  data_revision: string;
  uncertainty: number | null;
  fallback_label: string | null;
};

export function legacyScoreMeta(): ScoreEngineMeta {
  return {
    score_engine: "legacy-fallback",
    algorithm_version: CURRENT_METHODOLOGY.algorithmVersion,
    ruleset_hash: CURRENT_METHODOLOGY.rulesetHash,
    data_revision: "legacy-public-tables",
    uncertainty: 1,
    fallback_label: LEGACY_FALLBACK_LABEL,
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
} & ScoreEngineMeta;

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
      ${OSS}::int AS oss_score
    FROM providers p
    LEFT JOIN sovereignty s ON s.provider_id = p.id
    LEFT JOIN stacks st ON st.provider_id = p.id
    LEFT JOIN tiers t ON t.provider_id = p.id
    LEFT JOIN provider_locations pl ON pl.provider_id = p.id
    GROUP BY p.id, s.data_residency, st.hypervisor, st.orchestration, st.storage, st.container_runtime, st.control_plane, st.open_source, st.source_url
    ORDER BY p.is_local_asean DESC, p.name
  `);
  const meta = await loadScoreMetaByProvider(rows.map((r) => r.id));
  return rows.map((row) => ({ ...row, ...(meta.get(row.id) ?? legacyScoreMeta()) }));
}

async function loadScoreMetaByProvider(ids: string[]): Promise<Map<string, ScoreEngineMeta>> {
  const out = new Map<string, ScoreEngineMeta>();
  if (ids.length === 0) return out;
  try {
    const { rows } = await pool.query<{
      provider_id: string;
      algorithm_version: string;
      ruleset_hash: string;
      data_revision: string;
      uncertainty: number | null;
      engine: "canonical" | "legacy-fallback";
    }>(
      `SELECT DISTINCT ON (provider_id)
         provider_id, algorithm_version, ruleset_hash, data_revision, uncertainty::float, engine
       FROM scoring_runs
       WHERE provider_id = ANY($1)
       ORDER BY provider_id, created_at DESC`,
      [ids]
    );
    for (const row of rows) {
      out.set(row.provider_id, {
        score_engine: row.engine,
        algorithm_version: row.algorithm_version,
        ruleset_hash: row.ruleset_hash,
        data_revision: row.data_revision,
        uncertainty: row.uncertainty,
        fallback_label: row.engine === "legacy-fallback" ? LEGACY_FALLBACK_LABEL : null,
      });
    }
  } catch {
    /* scoring_runs absent: labeled legacy fallback */
  }
  return out;
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
  container_runtime: string | null;
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
} & ScoreEngineMeta;

export async function getProvider(id: string): Promise<ProviderDetail | null> {
  const { rows } = await pool.query(
    `
    SELECT
      p.id, p.name, p.hq_country, p.legal_country, p.legal_note, p.origin, p.is_local_asean, p.provider_type,
      s.data_residency, s.sea_strength,
      st.hypervisor, st.orchestration, st.storage, st.control_plane, st.container_runtime, st.virtualization, st.open_source, st.source_url,
      ${SOV}::int AS sov_score,
      ${CONF}::int AS conf_score,
      ${OSS}::int AS oss_score
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
         UNION ALL
         SELECT * FROM (
           SELECT DISTINCT ON (t.dc_country, t.dc_city)
             NULL::int AS id, t.dc_city AS city, t.dc_country AS country,
             'Undisclosed building' AS building, FALSE AS listed,
             NULL::text AS address, NULL::text AS operator
           FROM tiers t
           WHERE t.provider_id = $1 AND t.status = 'OK'
             AND btrim(COALESCE(t.dc_city,'')) <> ''
             AND t.dc_city !~* '^(undisclosed|unknown|not disclosed)'
             AND NOT EXISTS (
               SELECT 1 FROM provider_buildings pb2
               JOIN buildings b2 ON b2.id = pb2.building_id AND b2.listed
               WHERE pb2.provider_id = $1 AND b2.city = t.dc_city AND b2.country = t.dc_country
             )
             AND NOT EXISTS (
               SELECT 1 FROM provider_locations pl2
               JOIN locations l2 ON l2.id = pl2.location_id
               WHERE pl2.provider_id = $1 AND l2.city = t.dc_city AND l2.country = t.dc_country
             )
           ORDER BY t.dc_country, t.dc_city
         ) tier_cities
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
  const meta = await loadScoreMetaByProvider([id]);
  return {
    ...p,
    cities: locs.rows,
    sources: srcs.rows,
    tiers: tiers.rows,
    ...(meta.get(id) ?? legacyScoreMeta()),
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
  operator_country: string | null;
  dc_tier: string | null;
  telcos: string | null;
  dc_tech: string | null;
  facilities: string | null;
  lat: number | null;
  lng: number | null;
  last_checked_at: string | null;
  photo_path: string | null;
  photo_credit: string | null;
  photo_source: string | null;
  provider_count: number;
};

export async function getBuildings(): Promise<BuildingRow[]> {
  const { rows } = await pool.query<BuildingRow>(`
    SELECT
      b.id, b.name, b.city, b.country, b.listed, b.address, b.operator,
      b.operator_country, b.dc_tier, b.telcos, b.dc_tech, b.facilities,
      b.lat, b.lng, b.last_checked_at,
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
            b.operator_country, b.dc_tier, b.telcos, b.dc_tech, b.facilities,
            b.lat, b.lng, b.last_checked_at,
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

export type DirectoryUpdate = PublicDirectoryUpdate;

function mapChangeEventRow(row: Record<string, unknown>): ChangeEvent {
  const evidence = row.evidence_snapshot_ids;
  return {
    id: String(row.id),
    receiptId: String(row.receipt_id),
    revisionId: String(row.revision_id),
    proposalId: String(row.proposal_id),
    changeType: row.change_type as ChangeEvent["changeType"],
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    fieldName: String(row.field_name),
    oldValue: row.old_value,
    newValue: row.new_value,
    valueSensitivity: (row.value_sensitivity as ChangeEvent["valueSensitivity"]) ?? "public",
    sourceId: row.source_id ? String(row.source_id) : null,
    evidenceSnapshotIds: Array.isArray(evidence) ? evidence.filter((item): item is string => typeof item === "string") : [],
    detectedAt: row.detected_at ? String(row.detected_at) : null,
    observedAt: row.observed_at ? String(row.observed_at) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    publishedAt: String(row.published_at),
    correctionOfEventId: row.correction_of_event_id ? String(row.correction_of_event_id) : null,
    titleId: String(row.title_id),
    titleEn: String(row.title_en),
    summaryId: row.summary_id ? String(row.summary_id) : null,
    summaryEn: row.summary_en ? String(row.summary_en) : null,
    providerId: row.provider_id ? String(row.provider_id) : null,
    href: row.href ? String(row.href) : null,
  };
}

export async function getDirectoryUpdates(): Promise<DirectoryUpdate[]> {
  try {
    const events = await pool.query(`
      SELECT id, receipt_id, revision_id, proposal_id, change_type, entity_type, entity_id, field_name,
             old_value, new_value, value_sensitivity, source_id, evidence_snapshot_ids,
             detected_at::text AS detected_at, observed_at::text AS observed_at,
             reviewed_at::text AS reviewed_at, published_at::text AS published_at,
             correction_of_event_id, title_id, title_en, summary_id, summary_en, provider_id, href
      FROM change_events
      ORDER BY published_at DESC, id DESC
      LIMIT 80
    `);
    if (events.rows.length > 0) {
      return selectPublicUpdates(events.rows.map(mapChangeEventRow), []);
    }
  } catch {
    // Fall back to the legacy public table when the ledger is absent or empty.
  }
  const { rows } = await pool.query<LegacyDirectoryUpdate>(`
    SELECT id, kind, provider_id, title_id, title_en, summary_id, summary_en, href,
           occurred_at::text AS occurred_at
    FROM directory_updates
    ORDER BY occurred_at DESC, id DESC
    LIMIT 80
  `);
  return selectPublicUpdates([], rows);
}

async function loadIntelligenceFacts(): Promise<VerifiedFact[]> {
  try {
    const { rows } = await pool.query(
      `SELECT r.id AS receipt_id, r.revision_id, r.change_type, r.entity_type, r.entity_id, r.field_name,
              r.before_value, r.after_value, r.verification_state, r.methodology_version, r.data_revision,
              r.published_at::text AS published_at, r.supersedes_receipt_id,
              e.observed_at::text AS observed_at, e.provider_id, e.value_sensitivity
       FROM publication_receipts r
       JOIN change_events e ON e.receipt_id = r.id
       ORDER BY r.published_at DESC, r.id DESC
       LIMIT $1`,
      [MAX_TREND_FACTS]
    );
    return factsFromLedgerRows(rows.map((row) => ledgerFactRowFromJoin(row as Record<string, unknown>)));
  } catch {
    return [];
  }
}

export async function getTrendReport(args?: {
  countryCode?: string | null;
  providerId?: string | null;
  dataRevision?: string | null;
  window?: { start: string; end: string } | null;
}): Promise<ReturnType<typeof publicTrendView>> {
  const facts = await loadIntelligenceFacts();
  const window = args?.window ?? windowFromInferred(inferObservationWindow(facts));
  return publicTrendView(
    buildTrendReport({
      facts,
      window,
      countryCode: args?.countryCode ?? null,
      providerId: args?.providerId ?? null,
      dataRevision: args?.dataRevision ?? null,
    })
  );
}

export async function getProviderTimelineDoc(providerId: string) {
  const facts = await loadIntelligenceFacts();
  const window = windowFromInferred(inferObservationWindow(facts));
  return projectPublicTimelineDocument(buildProviderTimeline({ facts, window, providerId }));
}

export async function getCountryPageData(code: string) {
  const country = requireRegisteredIso2(code);
  const facts = await loadIntelligenceFacts();
  const window = windowFromInferred(inferObservationWindow(facts));
  const timeline = projectPublicTimelineDocument(buildCountryTimeline({ facts, window, countryCode: country.iso2 }));
  const trends = publicTrendView(buildTrendReport({ facts, window, countryCode: country.iso2 }));
  return { country, timeline, trends };
}

export async function getOutlookEligibility(metric: TrendMetric, countryCode?: string | null) {
  const facts = await loadIntelligenceFacts();
  const window = windowFromInferred(inferObservationWindow(facts));
  return publicOutlookEligibilityView(buildOutlook({ facts, window, countryCode: countryCode ?? null }, metric));
}
