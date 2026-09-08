import { SCORING_DIMENSIONS, type ScoringDimension } from "./types.ts";

export type SortMetricId = "sov" | "oss" | "conf" | "cost" | "cover" | "perf";

export type MetricDescriptor = {
  id: ScoringDimension | SortMetricId;
  code: string;
  labels: { id: string; en: string };
  engine: "canonical" | "legacy-alias";
  mapsTo?: ScoringDimension[];
};

export const CANONICAL_METRIC_DESCRIPTORS: Record<ScoringDimension, MetricDescriptor> = {
  primary_data_residency: {
    id: "primary_data_residency",
    code: "RES-P",
    labels: { id: "Residensi data utama", en: "Primary-data residency" },
    engine: "canonical",
  },
  backup_residency: {
    id: "backup_residency",
    code: "RES-B",
    labels: { id: "Residensi cadangan", en: "Backup residency" },
    engine: "canonical",
  },
  metadata_control_plane_residency: {
    id: "metadata_control_plane_residency",
    code: "RES-M",
    labels: { id: "Residensi metadata / control plane", en: "Metadata / control-plane residency" },
    engine: "canonical",
  },
  contracting_entity_legal_control: {
    id: "contracting_entity_legal_control",
    code: "LEG",
    labels: { id: "Entitas kontrak & kontrol hukum", en: "Contracting entity and legal control" },
    engine: "canonical",
  },
  administrative_access_key_control: {
    id: "administrative_access_key_control",
    code: "KEY",
    labels: { id: "Akses admin & kontrol kunci", en: "Administrative access and key control" },
    engine: "canonical",
  },
  evidence_coverage: {
    id: "evidence_coverage",
    code: "COV",
    labels: { id: "Cakupan bukti", en: "Evidence coverage" },
    engine: "canonical",
  },
  evidence_quality: {
    id: "evidence_quality",
    code: "QUAL",
    labels: { id: "Kualitas bukti", en: "Evidence quality" },
    engine: "canonical",
  },
  open_technology_portability: {
    id: "open_technology_portability",
    code: "OSS",
    labels: { id: "Teknologi terbuka & portabilitas", en: "Open technology and portability" },
    engine: "canonical",
  },
  commercial_comparability: {
    id: "commercial_comparability",
    code: "COM",
    labels: { id: "Keterbandingan komersial", en: "Commercial comparability" },
    engine: "canonical",
  },
};

export const SORT_METRIC_DESCRIPTORS: Record<SortMetricId, MetricDescriptor> = {
  sov: {
    id: "sov",
    code: "SOV",
    labels: { id: "Indikator kontrol & residensi", en: "Control & residency indicator" },
    engine: "legacy-alias",
    mapsTo: [
      "primary_data_residency",
      "backup_residency",
      "metadata_control_plane_residency",
      "contracting_entity_legal_control",
    ],
  },
  oss: {
    id: "oss",
    code: "OSS",
    labels: { id: "Indikator open technology", en: "Open-technology indicator" },
    engine: "legacy-alias",
    mapsTo: ["open_technology_portability"],
  },
  conf: {
    id: "conf",
    code: "CONF",
    labels: { id: "Kualitas bukti", en: "Evidence quality" },
    engine: "legacy-alias",
    mapsTo: ["evidence_quality", "evidence_coverage"],
  },
  cost: {
    id: "cost",
    code: "COST",
    labels: { id: "Harga dari (USD)", en: "Price from (USD)" },
    engine: "legacy-alias",
    mapsTo: ["commercial_comparability"],
  },
  cover: {
    id: "cover",
    code: "COVER",
    labels: { id: "Jumlah lokasi DC", en: "DC location count" },
    engine: "legacy-alias",
  },
  perf: {
    id: "perf",
    code: "PERF",
    labels: { id: "vCPU terbesar", en: "Largest vCPU" },
    engine: "legacy-alias",
  },
};

export function descriptorForSort(sort: SortMetricId): MetricDescriptor {
  return SORT_METRIC_DESCRIPTORS[sort];
}

export function sortMetricLabel(
  sort: SortMetricId,
  lang: "id" | "en",
  costCaption?: string
): string {
  if (sort === "cost" && costCaption) return costCaption;
  return SORT_METRIC_DESCRIPTORS[sort].labels[lang];
}

export function allCanonicalDescriptors(): MetricDescriptor[] {
  return SCORING_DIMENSIONS.map((id) => CANONICAL_METRIC_DESCRIPTORS[id]);
}
