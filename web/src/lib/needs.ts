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

export type ExtraQ = {
  key: string;
  idTitle: string;
  enTitle: string;
  options: { id: string; idLabel: string; enLabel: string }[];
};

export const SECTOR_EXTRAS: Record<Sector, ExtraQ[]> = {
  public: [
    {
      key: "residency",
      idTitle: "Apakah data utama harus tinggal di negara instansi?",
      enTitle: "Must primary data stay in the agency’s country?",
      options: [
        { id: "must_in_country", idLabel: "Ya, di negara instansi", enLabel: "Yes, in the agency’s country" },
        { id: "can_region", idLabel: "Cukup di ASEAN", enLabel: "ASEAN is enough" },
        { id: "unknown", idLabel: "Belum tahu", enLabel: "Not sure yet" },
      ],
    },
    {
      key: "hall",
      idTitle: "Perlu nama gedung yang bisa dicek?",
      enTitle: "Do you need a named hall you can check?",
      options: [
        { id: "need_hall", idLabel: "Ya, fasilitas bernama", enLabel: "Yes, a named facility" },
        { id: "city_enough", idLabel: "Kota saja cukup", enLabel: "City is enough" },
        { id: "unknown", idLabel: "Belum tahu", enLabel: "Not sure yet" },
      ],
    },
  ],
  fsi: [
    {
      key: "residency",
      idTitle: "Data nasabah atau transaksi harus di yurisdiksi tertentu?",
      enTitle: "Must customer or transaction data stay in a given jurisdiction?",
      options: [
        { id: "must_in_country", idLabel: "Ya, di negara operasi", enLabel: "Yes, in the operating country" },
        { id: "can_region", idLabel: "Cukup di ASEAN", enLabel: "ASEAN is enough" },
        { id: "unknown", idLabel: "Belum tahu", enLabel: "Not sure yet" },
      ],
    },
    {
      key: "hall",
      idTitle: "Perlu fasilitas bernama untuk audit?",
      enTitle: "Do you need a named facility for audit?",
      options: [
        { id: "need_hall", idLabel: "Ya, gedung harus tertulis", enLabel: "Yes, the hall must be named" },
        { id: "city_enough", idLabel: "Kota saja cukup", enLabel: "City is enough" },
        { id: "unknown", idLabel: "Belum tahu", enLabel: "Not sure yet" },
      ],
    },
  ],
  regulated: [
    {
      key: "residency",
      idTitle: "Kontrak mensyaratkan lokasi data yang tertulis?",
      enTitle: "Does the contract require a written data location?",
      options: [
        { id: "must_in_country", idLabel: "Ya, harus tertulis", enLabel: "Yes, it must be written" },
        { id: "can_region", idLabel: "Cukup region ASEAN", enLabel: "An ASEAN region is enough" },
        { id: "unknown", idLabel: "Belum tahu", enLabel: "Not sure yet" },
      ],
    },
    {
      key: "entity",
      idTitle: "Entitas kontrak harus badan lokal?",
      enTitle: "Must the contracting entity be a local company?",
      options: [
        { id: "local_entity", idLabel: "Ya, badan lokal", enLabel: "Yes, a local entity" },
        { id: "unknown", idLabel: "Belum tahu", enLabel: "Not sure yet" },
      ],
    },
  ],
  edu: [
    {
      key: "campus",
      idTitle: "Cloud ini terutama untuk apa?",
      enTitle: "What is this cloud mainly for?",
      options: [
        { id: "sis", idLabel: "Data siswa atau pegawai", enLabel: "Student or staff data" },
        { id: "lab", idLabel: "Lab, kelas, atau riset", enLabel: "Lab, class or research" },
        { id: "web", idLabel: "Situs kampus atau publikasi", enLabel: "Campus site or publishing" },
      ],
    },
    {
      key: "campus_prio",
      idTitle: "Yang paling penting di kampus?",
      enTitle: "What matters most on campus?",
      options: [
        { id: "stay_in_country", idLabel: "Data tinggal di negara kampus", enLabel: "Data stays in the campus country" },
        { id: "open_stack", idLabel: "Stack yang bisa diajarkan / dibuka", enLabel: "A stack we can teach or inspect" },
        { id: "cheap", idLabel: "Biaya lab yang terprediksi", enLabel: "Predictable lab cost" },
      ],
    },
  ],
  biz: [
    {
      key: "market",
      idTitle: "Pelanggan utama Anda di mana?",
      enTitle: "Where are your main customers?",
      options: [
        { id: "domestic", idLabel: "Dalam negeri", enLabel: "Domestic" },
        { id: "asean", idLabel: "ASEAN", enLabel: "ASEAN" },
        { id: "global", idLabel: "Global", enLabel: "Global" },
      ],
    },
    {
      key: "ops",
      idTitle: "Siapa yang akan mengoperasi cloud ini?",
      enTitle: "Who will operate this cloud?",
      options: [
        { id: "no_it", idLabel: "Belum ada tim IT", enLabel: "No IT team yet" },
        { id: "small", idLabel: "Tim kecil", enLabel: "A small team" },
        { id: "has_ops", idLabel: "Ada tim operasi", enLabel: "There is an ops team" },
      ],
    },
  ],
  learn: [
    {
      key: "learn_focus",
      idTitle: "Anda ingin memahami yang mana dulu?",
      enTitle: "What do you want to understand first?",
      options: [
        { id: "control", idLabel: "Di mana data duduk dan siapa yang pegang kunci hukum", enLabel: "Where data sits and who holds legal control" },
        { id: "price", idLabel: "Harga publik yang bisa dibanding", enLabel: "Public prices you can compare" },
        { id: "stack", idLabel: "Stack terbuka vs tertutup", enLabel: "Open vs closed stack" },
      ],
    },
  ],
};

export function extrasFor(sector: NeedsState["sector"]): ExtraQ[] {
  if (!sector) return [];
  return SECTOR_EXTRAS[sector];
}

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
  if (["public", "fsi", "regulated"].includes(state.sector) || state.extras.residency === "must_in_country" || state.extras.campus_prio === "stay_in_country" || state.extras.learn_focus === "control" || state.extras.market === "domestic") {
    priorities.unshift({ id: "Kontrol hukum dan residensi data di ASEAN", en: "Legal control and data residency in ASEAN" });
  }
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

  const wantControl =
    ["public", "fsi", "regulated"].includes(state.sector) ||
    sensitive ||
    state.extras.residency === "must_in_country" ||
    state.extras.hall === "need_hall" ||
    state.extras.entity === "local_entity" ||
    state.extras.campus_prio === "stay_in_country" ||
    state.extras.campus === "sis" ||
    state.extras.market === "domestic" ||
    state.extras.learn_focus === "control" ||
    state.priorities.includes("location");

  let sort: DerivedNeeds["sort"] = "cost";
  if (wantControl) sort = "sov";
  else if (state.extras.learn_focus === "stack" || state.extras.campus_prio === "open_stack" || state.priorities.includes("portability")) sort = "oss";
  else if (state.priorities.includes("perf")) sort = "perf";
  else if (state.priorities.includes("docs")) sort = "conf";
  else if (state.extras.learn_focus === "price" || state.extras.campus_prio === "cheap" || state.priorities.includes("cost") || state.workloads.includes("web")) sort = "cost";

  const aseanOnly = COUNTRIES.filter((c) => c !== "Timor-Leste" && c !== "Myanmar");
  const pickedAsean = state.countries.filter((c) => aseanOnly.includes(c) || c === "Timor-Leste");
  const country = pickedAsean.length === 1 ? pickedAsean[0] : "all";
  const scope: DerivedNeeds["scope"] =
    state.priorities.includes("support") ||
    state.sector === "public" ||
    wantControl ||
    state.extras.market === "asean" ||
    country !== "all"
      ? "asean"
      : "all";

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

  const why = wantControl
    ? {
        id: "Diurutkan dari indikator kontrol & residensi: kota DC ASEAN, badan hukum, dan gedung yang bisa dicek.",
        en: "Sorted by the control & residency indicator: ASEAN DC city, legal home, and a checkable hall.",
      }
    : {
        id: "Muncul karena cocok dengan batas yang Anda pilih dan punya data publik yang dapat ditelusuri.",
        en: "Shown because it matches your chosen limits and has public, traceable data.",
      };

  const checklist: DerivedNeeds["checklist"] = [
    { id: "Pastikan paket menyebut kota DC, bukan Undisclosed building.", en: "Confirm the plan names a DC city, not Undisclosed building." },
    { id: "Cek negara badan hukum — merek lokal tidak otomatis berarti kontrol lokal.", en: "Check the legal-entity country — a local brand is not automatically local control." },
    { id: "Kalau perlu audit fisik, pastikan ada gedung listed dengan nama resmi.", en: "If you need a physical audit, require a listed hall with an official name." },
    { id: "Konfirmasi lokasi backup, metadata, dan control plane.", en: "Confirm backup, metadata and control-plane locations." },
    { id: "Tanyakan entitas kontrak dan daftar subprocessor.", en: "Ask for the contracting entity and subprocessor list." },
    { id: "Periksa harga: storage, backup, traffic keluar, support, pajak, kurs.", en: "Check price extras: storage, backup, egress, support, tax, FX." },
  ];
  if (sensitive || state.extras.campus === "sis") checklist.push({ id: "DPA, retensi/penghapusan, akses admin, dan logging.", en: "DPA, retention/deletion, admin access and logging." });
  if (critical) checklist.push({ id: "SLA, uji restore, eskalasi insiden, dan rencana DR.", en: "SLA, restore tests, incident escalation and a DR plan." });
  if (state.priorities.includes("portability") || state.extras.campus_prio === "open_stack") checklist.push({ id: "Format ekspor, biaya keluar, dan bantuan migrasi.", en: "Export format, exit cost and migration help." });
  if (state.extras.ops === "no_it" || state.extras.ops === "small") checklist.push({ id: "Tanya dukungan lokal dan siapa yang dihubungi saat gangguan.", en: "Ask about local support and who to call during an outage." });

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
