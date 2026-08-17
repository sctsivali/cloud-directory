export type Sector = "public" | "fsi" | "regulated" | "edu" | "biz" | "learn";

export type NeedsState = {
  sector: Sector | "";
  workloads: string[];
  impact: string;
  data: string;
  countries: string[];
  priorities: string[];
  extras: Record<string, string>;
};

export const STORAGE_KEY = "cia-needs";
export const COMPARE_KEY = "cia-compare";

export function emptyNeeds(): NeedsState {
  return { sector: "", workloads: [], impact: "", data: "", countries: [], priorities: [], extras: {} };
}

export function loadNeeds(): NeedsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyNeeds();
    return { ...emptyNeeds(), ...JSON.parse(raw) };
  } catch {
    return emptyNeeds();
  }
}

export function saveNeeds(state: NeedsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function clearNeeds() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadCompare(): string[] {
  try {
    const raw = localStorage.getItem(COMPARE_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return ids.slice(0, 4);
  } catch {
    return [];
  }
}

export function saveCompare(ids: string[]) {
  try {
    localStorage.setItem(COMPARE_KEY, JSON.stringify(ids.slice(0, 4)));
  } catch {
    /* ignore */
  }
}

export const SECTORS: { id: Sector; idLabel: string; enLabel: string }[] = [
  { id: "public", idLabel: "Instansi pemerintah atau layanan publik", enLabel: "Government or public service" },
  { id: "fsi", idLabel: "Bank, asuransi, fintech, atau layanan keuangan", enLabel: "Bank, insurance, fintech or financial service" },
  { id: "regulated", idLabel: "Bisnis dengan aturan atau kontrak ketat", enLabel: "Business with strict rules or contracts" },
  { id: "edu", idLabel: "Sekolah, kampus, atau lembaga riset", enLabel: "School, campus or research body" },
  { id: "biz", idLabel: "Bisnis umum, startup, komunitas, atau nirlaba", enLabel: "General business, startup, community or nonprofit" },
  { id: "learn", idLabel: "Saya hanya sedang belajar atau membandingkan", enLabel: "I am only learning or comparing" },
];

export const WORKLOADS: { id: string; idLabel: string; enLabel: string }[] = [
  { id: "web", idLabel: "Website atau aplikasi publik", enLabel: "Public website or app" },
  { id: "internal", idLabel: "Sistem internal kantor", enLabel: "Internal office system" },
  { id: "customer", idLabel: "Data pelanggan atau pengguna", enLabel: "Customer or user data" },
  { id: "publicsvc", idLabel: "Sistem layanan publik", enLabel: "Public-facing service" },
  { id: "finance", idLabel: "Sistem transaksi atau layanan keuangan", enLabel: "Transactions or financial service" },
  { id: "academic", idLabel: "Sistem akademik, pembelajaran, atau riset", enLabel: "Academic, learning or research system" },
  { id: "backup", idLabel: "Backup dan pemulihan bencana", enLabel: "Backup and disaster recovery" },
  { id: "ai", idLabel: "Analitik atau AI", enLabel: "Analytics or AI" },
  { id: "unsure", idLabel: "Belum yakin—bantu saya mulai", enLabel: "Not sure — help me start" },
];

export const IMPACTS: { id: string; idLabel: string; enLabel: string }[] = [
  { id: "low", idLabel: "Mengganggu sedikit; bisa menunggu", enLabel: "Minor; we can wait" },
  { id: "ops", idLabel: "Operasional tim terganggu", enLabel: "Team operations are disrupted" },
  { id: "users", idLabel: "Banyak pengguna atau layanan utama terdampak", enLabel: "Many users or a core service are hit" },
  { id: "critical", idLabel: "Transaksi, keselamatan, layanan publik, atau kewajiban penting bisa terdampak", enLabel: "Transactions, safety, public service or a key duty could be hit" },
  { id: "unknown", idLabel: "Belum tahu", enLabel: "Not sure yet" },
];

export const DATA_LEVELS: { id: string; idLabel: string; enLabel: string }[] = [
  { id: "public", idLabel: "Tidak banyak; umumnya konten publik", enLabel: "Mostly public content" },
  { id: "personal", idLabel: "Data akun, kontak, pelanggan, siswa, pegawai, atau pengguna", enLabel: "Accounts, contacts, customers, students, staff or users" },
  { id: "sensitive", idLabel: "Data keuangan, kesehatan, identitas resmi, biometrik, atau sangat sensitif", enLabel: "Financial, health, official ID, biometric or highly sensitive" },
  { id: "secret", idLabel: "Data rahasia organisasi, pemerintah, atau riset", enLabel: "Organisation, government or research secrets" },
  { id: "unknown", idLabel: "Belum tahu", enLabel: "Not sure yet" },
];

export const COUNTRIES = [
  "Indonesia",
  "Malaysia",
  "Singapore",
  "Thailand",
  "Vietnam",
  "Philippines",
  "Brunei",
  "Cambodia",
  "Laos",
  "Myanmar",
  "Timor-Leste",
];

export const PRIORITIES: { id: string; idLabel: string; enLabel: string }[] = [
  { id: "cost", idLabel: "Biaya mudah diperkirakan", enLabel: "Predictable cost" },
  { id: "support", idLabel: "Dukungan lokal dan mudah dihubungi", enLabel: "Local, reachable support" },
  { id: "location", idLabel: "Data atau backup di lokasi tertentu", enLabel: "Data or backup in a chosen place" },
  { id: "resilience", idLabel: "Tahan gangguan dan mudah dipulihkan", enLabel: "Withstands outages and recovers" },
  { id: "security", idLabel: "Keamanan dan akses dapat dikendalikan", enLabel: "Security and access can be controlled" },
  { id: "docs", idLabel: "Dokumen penyedia mudah diperiksa", enLabel: "Provider documents are easy to check" },
  { id: "integrate", idLabel: "Mudah diintegrasikan dengan sistem lama", enLabel: "Easy to integrate with existing systems" },
  { id: "portability", idLabel: "Mudah pindah atau menghindari lock-in", enLabel: "Easy to move or avoid lock-in" },
  { id: "perf", idLabel: "Kapasitas atau performa", enLabel: "Capacity or performance" },
  { id: "simple", idLabel: "Tim kecil; ingin yang mudah dioperasikan", enLabel: "Small team; keep it simple" },
];

export type DerivedNeeds = {
  summary: { id: string; en: string };
  priorities: { id: string; en: string }[];
  unknowns: { id: string; en: string }[];
  validate: { id: string; en: string }[];
  sort: "sov" | "oss" | "cost" | "cover" | "perf" | "conf";
  scope: "asean" | "all";
  country: string;
  why: { id: string; en: string };
  checklist: { id: string; en: string }[];
  highImpact: boolean;
};

export function deriveNeeds(state: NeedsState): DerivedNeeds {
  const unknowns: DerivedNeeds["unknowns"] = [];
  if (!state.sector || state.sector === "learn") unknowns.push({ id: "Konteks organisasi masih umum.", en: "Organisation context is still general." });
  if (!state.workloads.length || state.workloads.includes("unsure")) unknowns.push({ id: "Jenis sistem belum ditetapkan.", en: "The system type is not set." });
  if (!state.impact || state.impact === "unknown") unknowns.push({ id: "Dampak gangguan belum diklasifikasikan.", en: "Outage impact is not classified." });
  if (!state.data || state.data === "unknown") unknowns.push({ id: "Klasifikasi data masih perlu disusun sebelum produksi.", en: "Data classification is still needed before production." });
  if (!state.countries.length) unknowns.push({ id: "Negara pengguna/operasi belum dipilih.", en: "User or operating country is not chosen." });

  const priorities: DerivedNeeds["priorities"] = [];
  const sensitive = ["personal", "sensitive", "secret"].includes(state.data);
  const critical = state.impact === "critical" || state.impact === "users";
  const highImpact =
    ["public", "fsi", "regulated"].includes(state.sector) && (sensitive || critical || state.workloads.includes("finance") || state.workloads.includes("publicsvc"));

  if (sensitive) priorities.push({ id: "Lokasi data, backup, dan alur data", en: "Data location, backup and data flow" });
  if (critical) priorities.push({ id: "Pemulihan layanan dan dukungan eskalasi", en: "Service recovery and escalation support" });
  if (state.priorities.includes("cost") || state.workloads.includes("web")) priorities.push({ id: "Biaya yang dapat dijelaskan", en: "Cost that can be explained" });
  if (state.priorities.includes("support") || state.priorities.includes("simple")) priorities.push({ id: "Dukungan dan kemudahan operasi", en: "Support and ease of operations" });
  if (state.priorities.includes("portability")) priorities.push({ id: "Portabilitas dan rencana keluar", en: "Portability and an exit plan" });
  if (state.priorities.includes("docs") || highImpact) priorities.push({ id: "Kualitas dan keterlacakan bukti", en: "Evidence quality and traceability" });
  if (state.priorities.includes("location") || state.countries.length === 1) priorities.push({ id: "Kecocokan region dengan operasi Anda", en: "Region fit with your operations" });
  if (!priorities.length) priorities.push({ id: "Kecocokan layanan, harga publik, dan bukti yang ada", en: "Service fit, public pricing and available evidence" });

  const validate: DerivedNeeds["validate"] = [];
  if (highImpact || sensitive) {
    validate.push({
      id: "Libatkan legal/compliance, security, dan pengadaan sebelum produksi.",
      en: "Involve legal/compliance, security and procurement before production.",
    });
  }
  if (state.sector === "fsi") {
    validate.push({
      id: "Risk, legal, compliance, dan security perlu menilai aktivitas serta aturan sektor.",
      en: "Risk, legal, compliance and security should assess the activity and sector rules.",
    });
  }
  if (state.sector === "public") {
    validate.push({
      id: "Legal/compliance instansi, keamanan, dan pengadaan perlu meninjau kebijakan lokasi serta kontrak.",
      en: "Agency legal/compliance, security and procurement should review location policy and the contract.",
    });
  }
  if (state.sector === "edu" && sensitive) {
    validate.push({
      id: "IT, pimpinan unit, procurement, dan pihak privacy institusi perlu meninjau shortlist.",
      en: "IT, unit leadership, procurement and institutional privacy should review the shortlist.",
    });
  }
  if (!validate.length) {
    validate.push({
      id: "Anda tetap dapat menyusun shortlist. Untuk data sensitif atau produksi, cari review yang berwenang.",
      en: "You can still build a shortlist. For sensitive data or production, get a competent review.",
    });
  }

  let sort: DerivedNeeds["sort"] = "cost";
  if (highImpact || state.priorities.includes("docs") || sensitive) sort = "conf";
  else if (state.priorities.includes("portability")) sort = "oss";
  else if (state.priorities.includes("perf")) sort = "perf";
  else if (state.priorities.includes("location")) sort = "cover";
  else if (state.priorities.includes("cost") || state.workloads.includes("web")) sort = "cost";

  const aseanOnly = COUNTRIES.filter((c) => c !== "Timor-Leste" && c !== "Myanmar");
  const pickedAsean = state.countries.filter((c) => aseanOnly.includes(c) || c === "Timor-Leste");
  const country = pickedAsean.length === 1 ? pickedAsean[0] : "all";
  const scope: DerivedNeeds["scope"] = state.priorities.includes("support") || state.sector === "public" || country !== "all" ? "asean" : "all";

  const summary = {
    id: `Karena Anda memilih ${labelJoin(state, "id")}, fokus awal adalah ${priorities
      .slice(0, 3)
      .map((p) => p.id)
      .join(", ")}. Ini screening, bukan keputusan final.`,
    en: `Because you chose ${labelJoin(state, "en")}, the first focus is ${priorities
      .slice(0, 3)
      .map((p) => p.en)
      .join(", ")}. This is screening, not a final decision.`,
  };

  const why = {
    id: "Muncul karena cocok dengan batas yang Anda pilih dan punya data publik yang dapat ditelusuri.",
    en: "Shown because it matches your chosen limits and has public, traceable data.",
  };

  const checklist: DerivedNeeds["checklist"] = [
    { id: "Konfirmasi lokasi data utama, backup, metadata, dan control plane.", en: "Confirm primary data, backup, metadata and control-plane locations." },
    { id: "Tanyakan entitas kontrak dan daftar subprocessor.", en: "Ask for the contracting entity and subprocessor list." },
    { id: "Periksa harga: storage, backup, traffic keluar, support, pajak, kurs.", en: "Check price extras: storage, backup, egress, support, tax, FX." },
    { id: "Minta bukti sumber primer yang masih berlaku untuk layanan dan region yang dipilih.", en: "Ask for current primary evidence for the chosen service and region." },
  ];
  if (sensitive) checklist.push({ id: "DPA, retensi/penghapusan, akses admin, dan logging.", en: "DPA, retention/deletion, admin access and logging." });
  if (critical) checklist.push({ id: "SLA, uji restore, eskalasi insiden, dan rencana DR.", en: "SLA, restore tests, incident escalation and a DR plan." });
  if (state.priorities.includes("portability")) checklist.push({ id: "Format ekspor, biaya keluar, dan bantuan migrasi.", en: "Export format, exit cost and migration help." });

  return { summary, priorities, unknowns, validate, sort, scope, country, why, checklist, highImpact };
}

function labelJoin(state: NeedsState, lang: "id" | "en") {
  const sector = SECTORS.find((s) => s.id === state.sector);
  const works = WORKLOADS.filter((w) => state.workloads.includes(w.id)).map((w) => (lang === "en" ? w.enLabel : w.idLabel));
  const bits = [sector ? (lang === "en" ? sector.enLabel : sector.idLabel) : lang === "en" ? "a general need" : "kebutuhan umum", ...works.slice(0, 2)];
  return bits.join(lang === "en" ? " + " : " + ");
}

export function arenaHref(derived: DerivedNeeds) {
  const q = new URLSearchParams();
  q.set("need", "1");
  q.set("sort", derived.sort);
  q.set("scope", derived.scope);
  if (derived.country !== "all") q.set("hq", derived.country);
  return `/arena?${q.toString()}`;
}
