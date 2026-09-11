/**
 * Frozen TypeScript encoding of the current production scoring and Arena
 * ranking rules (web/src/lib/db.ts SQL + ArenaView sort).
 *
 * These functions exist so Phase 0 regression tests can call the same rules
 * the site uses, without a database and without copying formulas into tests.
 * They are comparison evidence for the legacy engine, not the target
 * methodology for the future offering/deployment scorer.
 *
 * Known defects are recorded beside results; none are blessed as correct.
 */

export const LEGACY_ASEAN_COUNTRIES = [
  "Indonesia",
  "Malaysia",
  "Singapore",
  "Thailand",
  "Vietnam",
  "Philippines",
  "Cambodia",
  "Laos",
  "Myanmar",
  "Brunei",
] as const;

export const LEGACY_ASEAN_SQL = LEGACY_ASEAN_COUNTRIES.map((c) => `'${c}'`).join(",");

/** Matches %CITY% expansion in db.ts CITY_NAMED. */
export const LEGACY_CITY_NAMED_SQL = `
  btrim(COALESCE(%CITY%,'')) <> ''
  AND btrim(%CITY%) !~* '^(undisclosed|unknown|not disclosed)'
`;

export const LEGACY_SOV_SQL = `
  (
    CASE WHEN EXISTS (
      SELECT 1 FROM tiers tx
      WHERE tx.provider_id = p.id
        AND tx.status = 'OK'
        AND ${LEGACY_CITY_NAMED_SQL.replaceAll("%CITY%", "tx.dc_city")}
        AND COALESCE(tx.dc_country,'') IN (${LEGACY_ASEAN_SQL})
    ) OR EXISTS (
      SELECT 1 FROM provider_locations pl
      JOIN locations l ON l.id = pl.location_id
      WHERE pl.provider_id = p.id
        AND ${LEGACY_CITY_NAMED_SQL.replaceAll("%CITY%", "l.city")}
        AND l.country IN (${LEGACY_ASEAN_SQL})
    ) THEN 40 ELSE 0 END
    + CASE WHEN COALESCE(NULLIF(p.legal_country,''), p.hq_country, '') IN (${LEGACY_ASEAN_SQL})
      THEN 25 ELSE 0 END
    + CASE WHEN COALESCE(p.legal_country,'') IN (${LEGACY_ASEAN_SQL}) AND EXISTS (
        SELECT 1 FROM tiers tx
        WHERE tx.provider_id = p.id
          AND tx.status = 'OK'
          AND ${LEGACY_CITY_NAMED_SQL.replaceAll("%CITY%", "tx.dc_city")}
          AND tx.dc_country = p.legal_country
      ) THEN 15 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM provider_buildings pb
        JOIN buildings b ON b.id = pb.building_id
        WHERE pb.provider_id = p.id AND b.listed
      ) THEN 20 ELSE 0 END
  )
`;

export const LEGACY_CONF_SQL = `
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
          AND ${LEGACY_CITY_NAMED_SQL.replaceAll("%CITY%", "tx.dc_city")}
      ) THEN 15 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM sources so
        WHERE so.provider_id = p.id AND COALESCE(so.url,'') <> ''
      ) THEN 15 ELSE 0 END
    + CASE WHEN COALESCE(p.legal_country,'') <> '' THEN 15 ELSE 0 END
  )
`;

export const LEGACY_OSS_SQL = `
      (
        CASE WHEN COALESCE(st.hypervisor,'') ~* 'kvm|proxmox|xen' THEN 30 ELSE 0 END
        + CASE WHEN COALESCE(st.orchestration,'') ~* 'kubernetes|k8s|docker' THEN 20 ELSE 0 END
        + CASE WHEN COALESCE(st.storage,'') ~* 'ceph|openebs|longhorn|rook' THEN 20 ELSE 0 END
        + CASE WHEN st.open_source IS TRUE THEN 15 ELSE 0 END
        + CASE WHEN COALESCE(st.control_plane,'') ~* 'proxmox|openstack' THEN 15 ELSE 0 END
      )
`;

/** Current ingest FX table from scripts/ingest_provider.py. */
export const LEGACY_FX: Record<string, number> = {
  IDR: 16000,
  VND: 25000,
  THB: 35,
  SGD: 1.35,
  USD: 1,
  PHP: 56,
};

/** Fallback used when currency is missing from LEGACY_FX (IDR rate). */
export const LEGACY_DEFAULT_FX = 16000;

const CONF_HYPERVISOR_HEDGE =
  /likely|implied|typical|unknown|confirmed:|not disclosed|belum ditemukan|sales model|derived/i;

const UNDISCLOSED_CITY = /^(undisclosed|unknown|not disclosed)/i;

export type LegacyStack = {
  hypervisor?: string | null;
  orchestration?: string | null;
  storage?: string | null;
  container_runtime?: string | null;
  control_plane?: string | null;
  open_source?: boolean | null;
};

export type LegacyLocation = { city: string; country: string };

export type LegacyBuilding = {
  name: string;
  city: string;
  country: string;
  listed: boolean;
};

export type LegacyTier = {
  id: string;
  status: string;
  dc_city?: string | null;
  dc_country?: string | null;
  price_usd_month?: number | null;
  vcpu?: number | null;
  ram_gb?: number | null;
  billing_period?: string | null;
  currency?: string | null;
  promo?: boolean;
};

export type LegacySource = {
  url?: string | null;
  status?: string | null;
};

export type LegacyProviderRecord = {
  id: string;
  name: string;
  hq_country?: string | null;
  legal_country?: string | null;
  legal_note?: string | null;
  origin?: string | null;
  is_local_asean: boolean;
  data_residency?: string | null;
  stack?: LegacyStack;
  locations?: LegacyLocation[];
  buildings?: LegacyBuilding[];
  tiers?: LegacyTier[];
  sources?: LegacySource[];
};

export type LegacyScoreBreakdown = {
  sov: number;
  conf: number;
  oss: number;
  components: {
    sov: { residency: number; legal: number; legal_matches_dc: number; listed_facility: number };
    conf: {
      hq: number;
      hypervisor: number;
      listed_facility: number;
      named_tier_city: number;
      source_url: number;
      legal: number;
    };
    oss: {
      hypervisor: number;
      orchestration: number;
      storage: number;
      open_source: number;
      control_plane: number;
    };
  };
};

export function isLegacyNamedCity(city?: string | null): boolean {
  const trimmed = (city ?? "").trim();
  if (!trimmed) return false;
  return !UNDISCLOSED_CITY.test(trimmed);
}

export function isLegacyAseanCountry(country?: string | null): boolean {
  return !!country && (LEGACY_ASEAN_COUNTRIES as readonly string[]).includes(country);
}

export function legacyUsdMonth(amount: number, currency: string, fxIdrPerUsd = LEGACY_DEFAULT_FX): number {
  const cur = currency.toUpperCase();
  const fx = LEGACY_FX[cur] ?? fxIdrPerUsd;
  return Math.round((amount / fx) * 100) / 100;
}

function stackOf(p: LegacyProviderRecord): LegacyStack {
  return p.stack ?? {};
}

export function scoreLegacySov(p: LegacyProviderRecord): LegacyScoreBreakdown["components"]["sov"] {
  const tiers = p.tiers ?? [];
  const locations = p.locations ?? [];
  const buildings = p.buildings ?? [];
  const hasAseanNamedTier = tiers.some(
    (t) => t.status === "OK" && isLegacyNamedCity(t.dc_city) && isLegacyAseanCountry(t.dc_country ?? "")
  );
  const hasAseanNamedLocation = locations.some((l) => isLegacyNamedCity(l.city) && isLegacyAseanCountry(l.country));
  const residency = hasAseanNamedTier || hasAseanNamedLocation ? 40 : 0;
  const legalOrHq = p.legal_country && p.legal_country !== "" ? p.legal_country : (p.hq_country ?? "");
  const legal = isLegacyAseanCountry(legalOrHq) ? 25 : 0;
  const legal_matches_dc =
    p.legal_country && isLegacyAseanCountry(p.legal_country) &&
    tiers.some(
      (t) => t.status === "OK" && isLegacyNamedCity(t.dc_city) && t.dc_country === p.legal_country
    )
      ? 15
      : 0;
  const listed_facility = buildings.some((b) => b.listed) ? 20 : 0;
  return { residency, legal, legal_matches_dc, listed_facility };
}

export function scoreLegacyConf(p: LegacyProviderRecord): LegacyScoreBreakdown["components"]["conf"] {
  const st = stackOf(p);
  const hvRaw = st.hypervisor ?? "";
  const hvTrim = hvRaw.trim();
  let hypervisor = 0;
  if (hvTrim === "") hypervisor = 0;
  else if (CONF_HYPERVISOR_HEDGE.test(hvRaw)) hypervisor = 0;
  else if (hvTrim.length > 60) hypervisor = 0;
  else hypervisor = 20;

  const named_tier_city = (p.tiers ?? []).some(
    (t) => (t.dc_country ?? "") !== "" && isLegacyNamedCity(t.dc_city)
  )
    ? 15
    : 0;

  return {
    hq: (p.hq_country ?? "") !== "" ? 20 : 0,
    hypervisor,
    listed_facility: (p.buildings ?? []).some((b) => b.listed) ? 15 : 0,
    named_tier_city,
    source_url: (p.sources ?? []).some((s) => (s.url ?? "") !== "") ? 15 : 0,
    legal: (p.legal_country ?? "") !== "" ? 15 : 0,
  };
}

export function scoreLegacyOss(p: LegacyProviderRecord): LegacyScoreBreakdown["components"]["oss"] {
  const st = stackOf(p);
  return {
    hypervisor: /kvm|proxmox|xen/i.test(st.hypervisor ?? "") ? 30 : 0,
    orchestration: /kubernetes|k8s|docker/i.test(st.orchestration ?? "") ? 20 : 0,
    storage: /ceph|openebs|longhorn|rook/i.test(st.storage ?? "") ? 20 : 0,
    open_source: st.open_source === true ? 15 : 0,
    control_plane: /proxmox|openstack/i.test(st.control_plane ?? "") ? 15 : 0,
  };
}

export function scoreLegacyProvider(p: LegacyProviderRecord): LegacyScoreBreakdown {
  const sovParts = scoreLegacySov(p);
  const confParts = scoreLegacyConf(p);
  const ossParts = scoreLegacyOss(p);
  return {
    sov: sovParts.residency + sovParts.legal + sovParts.legal_matches_dc + sovParts.listed_facility,
    conf:
      confParts.hq +
      confParts.hypervisor +
      confParts.listed_facility +
      confParts.named_tier_city +
      confParts.source_url +
      confParts.legal,
    oss:
      ossParts.hypervisor +
      ossParts.orchestration +
      ossParts.storage +
      ossParts.open_source +
      ossParts.control_plane,
    components: { sov: sovParts, conf: confParts, oss: ossParts },
  };
}

export type LegacyArenaSort = "sov" | "oss" | "cost" | "cover" | "perf" | "conf";
export type LegacyArenaScope = "asean" | "all";

export type LegacyArenaRankable = {
  id: string;
  name: string;
  hq_country: string | null;
  is_local_asean: boolean;
  sov_score: number;
  oss_score: number;
  conf_score: number;
  min_price: number | null;
  loc_count: number;
  max_vcpu: number | null;
  max_ram: number | null;
};

/** Same fetch order as getArena(): local ASEAN first, then name. */
export function orderLikeGetArena<T extends { is_local_asean: boolean; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.is_local_asean !== b.is_local_asean) return a.is_local_asean ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Arena table ranking. Country filter is hard (unlike wizard shortlist).
 * Extracted from ArenaView so tests and the UI share one function.
 */
export function rankArenaRows<T extends LegacyArenaRankable>(
  rows: T[],
  tab: LegacyArenaSort,
  scope: LegacyArenaScope,
  country: string
): T[] {
  let base = scope === "asean" ? rows.filter((r) => r.is_local_asean) : rows;
  if (country !== "all") base = base.filter((r) => (r.hq_country || "") === country);
  const copy = [...base];
  copy.sort((a, b) => {
    if (tab === "sov") return b.sov_score - a.sov_score;
    if (tab === "oss") return b.oss_score - a.oss_score;
    if (tab === "conf") return b.conf_score - a.conf_score;
    if (tab === "cost") return (a.min_price ?? 9e9) - (b.min_price ?? 9e9);
    if (tab === "cover") return b.loc_count - a.loc_count;
    return (b.max_vcpu ?? 0) - (a.max_vcpu ?? 0) || (b.max_ram ?? 0) - (a.max_ram ?? 0);
  });
  return copy;
}

export type LegacyArenaRow = LegacyArenaRankable & {
  legal_country: string | null;
  hypervisor: string | null;
  orchestration: string | null;
  storage: string | null;
  container_runtime: string | null;
  control_plane: string | null;
  tier_count: number;
};

export function toLegacyArenaRow(p: LegacyProviderRecord): LegacyArenaRow {
  const scores = scoreLegacyProvider(p);
  const okPrices = (p.tiers ?? [])
    .filter((t) => t.status === "OK" && t.price_usd_month != null)
    .map((t) => t.price_usd_month as number);
  const vcpus = (p.tiers ?? []).map((t) => t.vcpu).filter((n): n is number => n != null);
  const rams = (p.tiers ?? []).map((t) => t.ram_gb).filter((n): n is number => n != null);
  return {
    id: p.id,
    name: p.name,
    hq_country: p.hq_country ?? null,
    legal_country: p.legal_country ?? null,
    is_local_asean: p.is_local_asean,
    hypervisor: p.stack?.hypervisor ?? null,
    orchestration: p.stack?.orchestration ?? null,
    storage: p.stack?.storage ?? null,
    container_runtime: p.stack?.container_runtime ?? null,
    control_plane: p.stack?.control_plane ?? null,
    sov_score: scores.sov,
    oss_score: scores.oss,
    conf_score: scores.conf,
    min_price: okPrices.length ? Math.min(...okPrices) : null,
    loc_count: p.locations?.length ?? 0,
    max_vcpu: vcpus.length ? Math.max(...vcpus) : null,
    max_ram: rams.length ? Math.max(...rams) : null,
    tier_count: p.tiers?.length ?? 0,
  };
}

/** Fields CompareView renders for a selected id list. */
export function compareLegacyValues<T extends LegacyArenaRow>(rows: T[], ids: string[]) {
  return ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is T => !!r)
    .map((r) => ({
      id: r.id,
      name: r.name,
      hq_country: r.hq_country,
      sov_score: r.sov_score,
      oss_score: r.oss_score,
      conf_score: r.conf_score,
      min_price: r.min_price,
      hypervisor: r.hypervisor,
    }));
}
