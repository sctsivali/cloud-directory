/** Canonical ISO 3166-1 alpha-2 registry used by country pages and trend filters. */

export type CountryRecord = {
  iso2: string;
  nameEn: string;
  nameId: string;
  asean: boolean;
  aliases: readonly string[];
};

export const ASEAN_ISO2 = ["BN", "KH", "ID", "LA", "MY", "MM", "PH", "SG", "TH", "VN"] as const;

export type AseanIso2 = (typeof ASEAN_ISO2)[number];

export const ISO_COUNTRY_REGISTRY: readonly CountryRecord[] = [
  { iso2: "BN", nameEn: "Brunei", nameId: "Brunei", asean: true, aliases: ["Brunei Darussalam", "Nation of Brunei"] },
  { iso2: "KH", nameEn: "Cambodia", nameId: "Kamboja", asean: true, aliases: ["Kampuchea"] },
  { iso2: "ID", nameEn: "Indonesia", nameId: "Indonesia", asean: true, aliases: ["Republic of Indonesia", "RI"] },
  { iso2: "LA", nameEn: "Laos", nameId: "Laos", asean: true, aliases: ["Lao PDR", "Lao People's Democratic Republic"] },
  { iso2: "MY", nameEn: "Malaysia", nameId: "Malaysia", asean: true, aliases: [] },
  { iso2: "MM", nameEn: "Myanmar", nameId: "Myanmar", asean: true, aliases: ["Burma"] },
  { iso2: "PH", nameEn: "Philippines", nameId: "Filipina", asean: true, aliases: ["The Philippines"] },
  { iso2: "SG", nameEn: "Singapore", nameId: "Singapura", asean: true, aliases: ["Republic of Singapore"] },
  { iso2: "TH", nameEn: "Thailand", nameId: "Thailand", asean: true, aliases: ["Kingdom of Thailand"] },
  { iso2: "VN", nameEn: "Vietnam", nameId: "Vietnam", asean: true, aliases: ["Viet Nam", "Socialist Republic of Vietnam"] },
  { iso2: "TL", nameEn: "Timor-Leste", nameId: "Timor Leste", asean: false, aliases: ["East Timor"] },
  { iso2: "US", nameEn: "United States", nameId: "Amerika Serikat", asean: false, aliases: ["USA", "United States of America"] },
  { iso2: "CN", nameEn: "China", nameId: "Tiongkok", asean: false, aliases: ["PRC", "People's Republic of China"] },
  { iso2: "GB", nameEn: "United Kingdom", nameId: "Britania Raya", asean: false, aliases: ["UK", "Great Britain"] },
  { iso2: "IN", nameEn: "India", nameId: "India", asean: false, aliases: [] },
  { iso2: "AT", nameEn: "Austria", nameId: "Austria", asean: false, aliases: [] },
  { iso2: "IL", nameEn: "Israel", nameId: "Israel", asean: false, aliases: [] },
] as const;

const BY_ISO = new Map(ISO_COUNTRY_REGISTRY.map((row) => [row.iso2, row]));

function normalizeToken(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

const BY_ALIAS = new Map<string, CountryRecord>();
for (const row of ISO_COUNTRY_REGISTRY) {
  BY_ALIAS.set(normalizeToken(row.iso2), row);
  BY_ALIAS.set(normalizeToken(row.nameEn), row);
  BY_ALIAS.set(normalizeToken(row.nameId), row);
  for (const alias of row.aliases) {
    BY_ALIAS.set(normalizeToken(alias), row);
  }
}

export function isIso2(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

export function canonicalizeCountryCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isIso2(trimmed.toUpperCase())) {
    const iso = trimmed.toUpperCase();
    return BY_ISO.has(iso) ? iso : null;
  }
  return resolveCountry(trimmed)?.iso2 ?? null;
}

export function getCountry(iso2: string): CountryRecord | null {
  const code = iso2.trim().toUpperCase();
  return BY_ISO.get(code) ?? null;
}

export function resolveCountry(value: string | null | undefined): CountryRecord | null {
  if (!value) return null;
  return BY_ALIAS.get(normalizeToken(value)) ?? null;
}

export function requireRegisteredIso2(code: string): CountryRecord {
  if (!isIso2(code) || !BY_ISO.has(code)) {
    throw new Error(`unregistered country code: ${code}`);
  }
  return BY_ISO.get(code)!;
}

export function aseanCountries(): CountryRecord[] {
  return ISO_COUNTRY_REGISTRY.filter((row) => row.asean);
}

export function extractCountryFromValue(value: unknown): string | null {
  if (typeof value === "string") return canonicalizeCountryCode(value);
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["countryCode", "iso2", "country", "hqCountry", "deploymentCountry"]) {
    const raw = record[key];
    if (typeof raw === "string") {
      const resolved = canonicalizeCountryCode(raw) ?? resolveCountry(raw)?.iso2 ?? null;
      if (resolved) return resolved;
    }
  }
  return null;
}
