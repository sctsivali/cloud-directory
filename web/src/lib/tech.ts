export type TechKind = "hypervisor" | "platform" | "container" | "orchestrator" | "storage" | "control";

export type TechCopy = {
  title: string;
  lead: string;
  what: string;
  plus: string[];
  minus: string[];
  why: string;
};

export type Tech = {
  slug: string;
  kind: TechKind;
  name: string;
  open: boolean;
  licence?: "open" | "closed" | "varies";
  logo?: string;
  needles: string[];
  id: TechCopy;
  en: TechCopy;
};

export const TECH: Tech[] = [
  {
    slug: "kvm",
    kind: "hypervisor",
    name: "KVM",
    open: true,
    needles: ["kvm"],
    id: {
      title: "KVM: fondasi virtualisasi terbuka yang dipakai banyak cloud",
      lead: "KVM membuat Linux bisa menjalankan banyak virtual machine di satu server fisik. Kalau Anda pernah sewa VPS, cukup besar kemungkinan ada KVM di belakangnya.",
      what: "Karena KVM terbuka, model virtualisasinya dapat dipelajari dan diaudit. Skill yang dipakai di lab juga relatif mudah dibawa ke produksi. Tapi KVM tidak menjawab di mana data berada, siapa yang punya akses administrator, atau bagaimana provider mengelola control plane.",
      plus: [
        "Kodenya terbuka: tim internal atau auditor bisa meninjau, bukan hanya percaya brosur.",
        "Tidak terikat lisensi VMware. Pindah penyedia lebih mudah kalau format disk standar.",
        "Jalan di perangkat biasa. Kampus dan lab di ASEAN bisa melatih skill yang sama dengan produksi.",
      ],
      minus: [
        "Nama KVM di halaman harga tidak selalu berarti build yang sama. Vendor besar sering memodifikasi dalam-dalam.",
        "Tanpa dokumentasi CPU dan isolasi, KVM bisa jadi label saja.",
        "Anda tetap bergantung pada siapa yang memegang kunci akses di pusat data.",
      ],
      why: "KVM membantu keterbukaan teknis. Ia bukan sertifikat kedaulatan data.",
    },
    en: {
      title: "KVM: an open virtualisation layer used by many clouds",
      lead: "KVM lets Linux run many virtual machines on one physical server. If you have ever rented a VPS, there is a fair chance KVM is underneath.",
      what: "KVM (Kernel-based Virtual Machine) sits in the Linux kernel and splits one physical host into virtual machines. Most ASEAN VPS products run on it, sometimes under a house brand.",
      plus: [
        "The code is public, so an internal team or auditor can review it.",
        "No VMware licence lock. Moving providers is easier when disk formats stay standard.",
        "It runs on ordinary hardware, so campuses across ASEAN can practise the same stack used in production.",
      ],
      minus: [
        "A marketing line that says KVM is not proof of the same build. Large vendors often customise it heavily.",
        "Without CPU and isolation notes, KVM can be a label only.",
        "You still depend on whoever holds the access keys in the data centre.",
      ],
      why: "For readers in Jakarta, Hanoi, Kuala Lumpur or Manila: KVM makes audit possible. That is why the open-source score weights it — not because it is always faster.",
    },
  },
  {
    slug: "proxmox",
    kind: "hypervisor",
    name: "Proxmox VE",
    open: true,
    needles: ["proxmox"],
    id: {
      title: "Proxmox VE: mengelola virtualisasi dengan control plane yang dapat dijalankan sendiri",
      lead: "Proxmox menggabungkan KVM, LXC, clustering, backup, dan antarmuka manajemen. Nilainya ada pada kontrol operasional—bukan sekadar label di belakang VPS.",
      what: "Proxmox Virtual Environment menggabungkan KVM, kontainer LXC, cadangan, dan klaster. Lisensinya terbuka; dukungan berbayar opsional.",
      plus: [
        "Satu panel untuk VM dan kontainer, tanpa mengunci ke merek hyperscaler.",
        "Bisa dijalankan di rak sendiri atau di dedicated server penyedia ASEAN.",
        "Komunitas dan dokumentasi cukup untuk tim kecil.",
      ],
      minus: [
        "Bukan produk VPS jadi. Kalau penyedia hanya menulis Proxmox, tanyakan: Anda dapat akses panel, atau cuma VM di belakangnya?",
        "Klaster dan cadangan butuh desain. Salah pasang tetap bisa bocor atau mati.",
        "Fitur enterprise (replikasi tertentu) ada di langganan — tetap terbuka, tapi dukungan berbayar.",
      ],
      why: "Proxmox sering jadi jalan pulang dari cloud mahal: tim di ASEAN bisa mengoperasikan sendiri, dengan hypervisor yang sama-sama bisa diaudit.",
    },
    en: {
      title: "Proxmox VE: run the virtualisation control plane yourself",
      lead: "Proxmox is how you operate KVM (and LXC) with a console you can install yourself. Useful when you want control on your own soil, not only a rented VPS.",
      what: "Proxmox Virtual Environment combines KVM, LXC containers, backup and clustering. The licence is open; paid support is optional.",
      plus: [
        "One console for VMs and containers, without a hyperscaler brand lock.",
        "It can run on your own racks or on an ASEAN dedicated server.",
        "Community and docs are enough for a small team.",
      ],
      minus: [
        "It is not a finished VPS product. If a provider only writes Proxmox, ask whether you get the panel or just a VM behind it.",
        "Clusters and backups need design. A bad install can still leak or fail.",
        "Some enterprise features sit behind a subscription — still open, but support is paid.",
      ],
      why: "Proxmox is often the way back from expensive public cloud: an ASEAN team can operate it, on a hypervisor that can be audited.",
    },
  },
  {
    slug: "vmware",
    kind: "hypervisor",
    name: "VMware vSphere",
    open: false,
    needles: ["vmware", "vsphere", "esxi"],
    id: {
      title: "VMware vSphere: platform enterprise matang dengan trade-off lisensi dan portabilitas",
      lead: "vSphere umum di cloud telko dan enterprise ASEAN. Kinerjanya terbukti. Kodenya tidak terbuka, dan lisensi mengikuti kebijakan Broadcom.",
      what: "VMware ESXi + vCenter mengelola mesin virtual di pusat data. Banyak penyedia telko menulis “VMware Cloud Verified”.",
      plus: [
        "Ekosistem operasional sudah dikenal tim enterprise dan auditor lama.",
        "Fitur HA, vMotion, dan integrasi cadangan sudah matang.",
        "Cocok jika kontrak Anda mensyaratkan stack yang sudah dikenal pengadaan.",
      ],
      minus: [
        "Sumber tertutup: Anda tidak bisa mengaudit hypervisor, hanya sertifikat dan SLA.",
        "Harga dan syarat lisensi bisa berubah dari pihak ketiga di luar ASEAN.",
        "Pindah keluar sering mahal karena alat dan skill terikat merek.",
      ],
      why: "Netralnya: VMware sah untuk beban yang butuh jejak enterprise. Itu bukan skor kedaulatan. Kendali hukum tetap mengikuti vendor dan negara induknya.",
    },
    en: {
      title: "VMware vSphere: a mature enterprise platform with licence and portability trade-offs",
      lead: "vSphere is common in ASEAN telco and enterprise clouds. It is proven. The code is closed, and licensing follows Broadcom policy.",
      what: "VMware ESXi plus vCenter runs virtual machines in a data centre. Many telco providers list “VMware Cloud Verified”.",
      plus: [
        "Operations are familiar to enterprise teams and long-standing auditors.",
        "HA, vMotion and backup integrations are mature.",
        "Useful when procurement already requires that stack.",
      ],
      minus: [
        "Closed source: you cannot audit the hypervisor, only certificates and the SLA.",
        "Licence price and terms can change with a vendor outside ASEAN.",
        "Leaving is often expensive because tools and skills are brand-tied.",
      ],
      why: "Neutral view: VMware is valid for workloads that need an enterprise trail. That is not a sovereignty score. Legal control still follows the vendor and its home country.",
    },
  },
  {
    slug: "hyper-v",
    kind: "hypervisor",
    name: "Hyper-V",
    open: false,
    needles: ["hyper-v", "hyperv"],
    id: {
      title: "Hyper-V: pilihan kuat untuk workload Windows, dengan platform tertutup",
      lead: "Hyper-V dipakai Azure dan sebagian dedicated Windows. Isolasinya kuat di ekosistem Microsoft. Sumbernya tertutup.",
      what: "Hyper-V adalah hypervisor Windows Server / Azure. Azure menambah isolasi kontainer terpisah di atasnya.",
      plus: [
        "Integrasi alami dengan Windows, Active Directory, dan Azure.",
        "Batas VM di Azure terdokumentasi untuk beban yang butuh pemisahan keras.",
      ],
      minus: [
        "Tertutup. Audit mandiri terbatas pada dokumen Microsoft.",
        "CLOUD Act AS berlaku untuk Microsoft, termasuk rak yang ada di Asia.",
        "Beban Linux bisa jalan, tapi kendali platform tetap di stack Microsoft.",
      ],
      why: "Pilih Hyper-V jika aplikasi Anda memang hidup di Windows. Jangan samakan “ada region Asia” dengan data di luar jangkauan hukum AS.",
    },
    en: {
      title: "Hyper-V: strong for Windows workloads, on a closed platform",
      lead: "Hyper-V powers Azure and some Windows dedicated hosts. Isolation is strong inside Microsoft’s world. The source is closed.",
      what: "Hyper-V is the Windows Server / Azure hypervisor. Azure adds stronger isolated containers on top.",
      plus: [
        "Natural fit for Windows, Active Directory and Azure.",
        "Azure VM isolation is documented for workloads that need a hard split.",
      ],
      minus: [
        "Closed. Independent audit is limited to Microsoft’s papers.",
        "The US CLOUD Act applies to Microsoft, including racks in Asia.",
        "Linux can run, but platform control stays in the Microsoft stack.",
      ],
      why: "Choose Hyper-V if the application already lives on Windows. Do not treat “an Asia region” as data beyond US legal reach.",
    },
  },
  {
    slug: "xen",
    kind: "hypervisor",
    name: "Xen",
    open: true,
    needles: ["xen"],
    id: {
      title: "Xen: hypervisor terbuka yang status penggunaannya perlu diverifikasi",
      lead: "Xen pernah jadi tulang punggung AWS dan beberapa cloud Asia. Masih open source. Di banyak tempat digeser KVM.",
      what: "Xen memisahkan domain istimewa (dom0) dari mesin tamu. Mode PV dan HVM masih muncul di catatan penyedia lama.",
      plus: [
        "Terbuka, dengan sejarah panjang di produksi besar.",
        "Model isolasinya berbeda dari KVM — berguna untuk memahami desain, bukan hanya merek.",
      ],
      minus: [
        "Ekosistem alat baru lebih ramai di KVM.",
        "Penyedia yang menulis “Xen historis” mungkin sudah pindah; cek tanggal dokumen.",
      ],
      why: "Xen tetap sah. Yang penting: apakah build-nya masih dipakai, atau hanya sisa kalimat di halaman lama.",
    },
    en: {
      title: "Xen: an open hypervisor whose current use still needs verifying",
      lead: "Xen once underpinned AWS and several Asian clouds. It is still open source. In many places KVM has replaced it.",
      what: "Xen splits a privileged domain (dom0) from guest machines. PV and HVM modes still appear in older provider notes.",
      plus: [
        "Open, with a long production history.",
        "Its isolation model differs from KVM — useful to understand design, not just brands.",
      ],
      minus: [
        "Newer tooling is busier around KVM.",
        "A line that says “historical Xen” may be stale; check the document date.",
      ],
      why: "Xen remains valid. The question is whether the build is still in use, or only leftover copy on an old page.",
    },
  },
  {
    slug: "nitro",
    kind: "hypervisor",
    name: "AWS Nitro",
    open: false,
    needles: ["nitro"],
    id: {
      title: "AWS Nitro: isolasi dan offload kuat, dengan kendali platform tetap di AWS",
      lead: "Nitro adalah lapisan AWS di atas ide KVM, plus kartu offload. Performa dan isolasinya kuat. Anda tidak mengoperasikan hypervisor itu sendiri.",
      what: "Sistem Nitro memindahkan jaringan, penyimpanan, dan keamanan ke perangkat khusus. VM di EC2 duduk di atasnya.",
      plus: [
        "Isolasi dan offload terdokumentasi untuk skala besar.",
        "Banyak alat, region, dan sertifikasi — termasuk di Singapura dan Jakarta.",
      ],
      minus: [
        "Bukan KVM vanila. Anda tidak memasang atau mengaudit Nitro seperti Proxmox di rak sendiri.",
        "Amazon adalah perusahaan AS. CLOUD Act tetap relevan meski raknya di ASEAN.",
        "Harga jaringan dan kunci API mengikat beban ke ekosistem AWS.",
      ],
      why: "Nitro menjelaskan kenapa “pakai KVM” di AWS tidak sama dengan KVM di penyedia lokal. Yang diukur di sini: kendali, bukan hanya keluarga teknis.",
    },
    en: {
      title: "AWS Nitro: strong isolation, with the platform still controlled by AWS",
      lead: "Nitro is AWS’s layer on KVM ideas, plus offload cards. Isolation and speed are strong. You do not operate that hypervisor yourself.",
      what: "Nitro moves networking, storage and security onto dedicated hardware. EC2 VMs sit on top.",
      plus: [
        "Isolation and offload are documented at large scale.",
        "Tools, regions and certifications are broad — including Singapore and Jakarta.",
      ],
      minus: [
        "It is not vanilla KVM. You cannot install or audit Nitro the way you would Proxmox on your own rack.",
        "Amazon is a US company. The CLOUD Act still applies with racks in ASEAN.",
        "Network prices and API keys tend to lock workloads into AWS.",
      ],
      why: "Nitro shows why “uses KVM” on AWS is not the same as KVM at a local provider. This site measures control, not only the technical family.",
    },
  },
  {
    slug: "openstack",
    kind: "platform",
    name: "OpenStack",
    open: true,
    needles: ["openstack"],
    id: {
      title: "OpenStack: membangun cloud dengan API terbuka dan kendali operator",
      lead: "OpenStack adalah perangkat lunak cloud (hitung, jaringan, citra, identitas) yang terbuka. Beberapa penyedia ASEAN membangun layanan di atasnya.",
      what: "Proyek-proyek seperti Nova, Neutron, Cinder, Glance, Keystone membentuk IaaS. Bisa dipasang di pusat data sendiri atau dipakai sebagai layanan.",
      plus: [
        "API terbuka: pola yang sama bisa diulang di penyedia lain atau di rak sendiri.",
        "Tidak ada lisensi hypervisor wajib. Sering dipasangkan dengan KVM dan Ceph.",
        "Cocok untuk kebijakan “bisa diaudit” di lembaga dan kampus ASEAN.",
      ],
      minus: [
        "Operasi berat. Salah desain jadi mahal dan rapuh.",
        "“OpenStack-derived” di brosur bisa berarti fork tertutup.",
        "Butuh tim. Ini bukan panel VPS satu klik.",
      ],
      why: "OpenStack adalah contoh cloud yang kedaulatannya bisa dipegang operator lokal — jika mereka benar-benar menjalankannya, bukan hanya menempel merek.",
    },
    en: {
      title: "OpenStack: open APIs and operator control, with real operational cost",
      lead: "OpenStack is open cloud software (compute, network, images, identity). Some ASEAN providers build services on it.",
      what: "Projects such as Nova, Neutron, Cinder, Glance and Keystone form an IaaS. It can run in your data centre or as someone else’s service.",
      plus: [
        "Open APIs: the same pattern can be repeated at another provider or on your own racks.",
        "No mandatory hypervisor licence. Often paired with KVM and Ceph.",
        "Fits “can be audited” policies in ASEAN institutions and campuses.",
      ],
      minus: [
        "Heavy to operate. A weak design is expensive and fragile.",
        "“OpenStack-derived” on a brochure can mean a closed fork.",
        "It needs a team. This is not a one-click VPS panel.",
      ],
      why: "OpenStack is an example of a cloud whose sovereignty a local operator can hold — if they actually run it, not only paste the brand.",
    },
  },
  {
    slug: "docker",
    kind: "container",
    name: "Docker",
    open: true,
    needles: ["docker"],
    id: {
      title: "Docker: memaketkan aplikasi agar lebih mudah dipindahkan—bukan menggantikan VM",
      lead: "Docker membungkus aplikasi dan dependensinya. Itu bukan pengganti hypervisor. Banyak VPS ASEAN “mendukung Docker” — artinya Anda yang memasangnya di atas VM.",
      what: "Docker Engine memakai namespace dan cgroup Linux. Citra bisa dipindah antar mesin yang sama-sama Linux.",
      plus: [
        "Aplikasi jadi portabel. Tim di Ho Chi Minh, Bangkok, atau Jakarta bisa memakai citra yang sama.",
        "Lebih ringan dari VM penuh untuk banyak layanan kecil.",
        "Ekosistem citra dan dokumentasi luas.",
      ],
      minus: [
        "Isolasinya lebih tipis dari hypervisor. Satu kernel dibagi.",
        "Merek Docker dan format citra OCI tidak sama dengan “aman otomatis”.",
        "Tanpa orkestrasi, puluhan kontainer cepat kacau.",
      ],
      why: "Docker membantu portabilitas. Kedaulatan tetap di hypervisor, lokasi rak, dan negara operator — bukan di file Dockerfile.",
    },
    en: {
      title: "Docker: packages apps so they move more easily—it does not replace a VM",
      lead: "Docker wraps an app and its dependencies. It does not replace a hypervisor. Many ASEAN VPS pages “support Docker” — meaning you install it on the VM.",
      what: "Docker Engine uses Linux namespaces and cgroups. Images move between machines that share a similar Linux userland.",
      plus: [
        "Apps become portable. Teams in Ho Chi Minh City, Bangkok or Jakarta can use the same image.",
        "Lighter than a full VM for many small services.",
        "Image ecosystem and docs are wide.",
      ],
      minus: [
        "Isolation is thinner than a hypervisor. One kernel is shared.",
        "The Docker brand and the OCI image format are not automatic security.",
        "Without orchestration, dozens of containers get messy fast.",
      ],
      why: "Docker helps portability. Sovereignty still sits in the hypervisor, the rack location and the operator’s country — not in a Dockerfile.",
    },
  },
  {
    slug: "containerd",
    kind: "container",
    name: "containerd",
    open: true,
    needles: ["containerd"],
    id: {
      title: "containerd: runtime di balik banyak cluster Kubernetes",
      lead: "Kubernetes modern lebih sering memanggil containerd daripada Docker Engine. Itu komponen terbuka dari ekosistem CNCF.",
      what: "containerd menarik citra, menjalankan kontainer, dan menyerahkan jaringan/penyimpanan ke plugin. Docker Engine sendiri memakai containerd.",
      plus: [
        "Standar de facto di klaster Kubernetes.",
        "Lebih ramping dari Docker Engine penuh.",
        "Terbuka, bisa diaudit.",
      ],
      minus: [
        "Bukan alat harian untuk pemula — biasanya disembunyikan orkestrator.",
        "Nama di brosur tanpa versi dan runtime class tidak banyak artinya.",
      ],
      why: "Kalau penyedia menulis containerd, mereka biasanya bicara fondasi Kubernetes. Tanyakan siapa yang pegang control plane.",
    },
    en: {
      title: "containerd: the runtime behind many Kubernetes clusters",
      lead: "Modern Kubernetes usually calls containerd, not Docker Engine. It is an open CNCF component.",
      what: "containerd pulls images, runs containers, and leaves networking/storage to plugins. Docker Engine itself uses containerd.",
      plus: [
        "De-facto standard on Kubernetes clusters.",
        "Leaner than a full Docker Engine.",
        "Open and auditable.",
      ],
      minus: [
        "Not a beginner daily tool — usually hidden by the orchestrator.",
        "A brochure name without version and runtime class means little.",
      ],
      why: "If a provider lists containerd, they are usually talking about a Kubernetes base. Ask who holds the control plane.",
    },
  },
  {
    slug: "firecracker",
    kind: "container",
    name: "Firecracker",
    open: true,
    needles: ["firecracker"],
    id: {
      title: "Firecracker: microVM ringan untuk serverless dan workload berumur pendek",
      lead: "Firecracker (AWS, terbuka) membuat mesin virtual sangat kecil. Dipakai Lambda dan beberapa platform fungsi. Bukan VPS harian.",
      what: "MicroVM dengan perangkat minimal, start cepat, isolasi lebih kuat dari kontainer biasa.",
      plus: [
        "Isolasi lebih dekat ke VM daripada Docker biasa.",
        "Kodenya terbuka, meski produksi AWS memakai rangkaian tertutup di sekitarnya.",
      ],
      minus: [
        "Bukan pengganti VPS. Tidak untuk OS lengkap harian.",
        "Di AWS, Anda tidak mengoperasikan Firecracker sendiri.",
      ],
      why: "Penting untuk memahami serverless. Jangan dikira sama dengan KVM dedicated di penyedia lokal.",
    },
    en: {
      title: "Firecracker: light microVMs for short-lived workloads",
      lead: "Firecracker (from AWS, open) builds very small virtual machines. Lambda and some function platforms use it. It is not a daily VPS.",
      what: "A microVM with a tiny device model, fast start, and stronger isolation than a normal container.",
      plus: [
        "Isolation is closer to a VM than to plain Docker.",
        "The code is open, even if AWS production wraps it in a closed plane.",
      ],
      minus: [
        "Not a VPS replacement. Not for a full daily OS.",
        "On AWS you do not operate Firecracker yourself.",
      ],
      why: "Useful to understand serverless. Do not treat it as the same thing as dedicated KVM at a local provider.",
    },
  },
  {
    slug: "kubernetes",
    kind: "orchestrator",
    name: "Kubernetes",
    open: true,
    needles: ["kubernetes", "k8s", "eks", "aks", "gke", "doks", "lke", "oke", "tke", "vke"],
    id: {
      title: "Kubernetes: orkestrasi container, bukan jaminan portabilitas atau kedaulatan",
      lead: "Kubernetes menjadwalkan kontainer di banyak mesin. Hampir semua cloud besar menawarkan versi terkelola. Control plane-nya yang menentukan siapa yang berdaulat.",
      what: "API klaster mengatur pod, layanan, dan penskalaan. Distro terkelola (EKS, AKS, GKE, DOKS, dan sejenisnya) menjalankan control plane sebagai layanan.",
      plus: [
        "Keterampilan yang sama dipakai di banyak negara ASEAN.",
        "Upstream-nya terbuka. Anda bisa memasang sendiri di KVM lokal.",
        "Memudahkan pindah beban jika citra dan manifes tidak terikat layanan proprietary.",
      ],
      minus: [
        "Klaster terkelola sering mengunci ke jaringan dan disk vendor itu.",
        "Kompleks. Tim kecil bisa lebih aman di VM biasa plus Docker Compose.",
        "Nama “Kubernetes” di harga tidak menjelaskan di negara mana etcd dan API server tinggal.",
      ],
      why: "Tanyakan: control plane di negara mana, siapa yang pegang kunci, dan apakah Anda bisa mengekspor klaster. Itu pertanyaan kedaulatan, bukan soal logo helm.",
    },
    en: {
      title: "Kubernetes: container orchestration, not a portability or sovereignty guarantee",
      lead: "Kubernetes schedules containers across machines. Almost every large cloud sells a managed flavour. The control plane decides who is sovereign.",
      what: "A cluster API runs pods, services and scaling. Managed distros (EKS, AKS, GKE, DOKS and kin) run that control plane as a service.",
      plus: [
        "The same skill set is used across ASEAN countries.",
        "Upstream is open. You can install it yourself on local KVM.",
        "Workloads move more easily if images and manifests avoid proprietary extras.",
      ],
      minus: [
        "Managed clusters often lock to that vendor’s network and disks.",
        "Complex. A small team may be safer on plain VMs plus Docker Compose.",
        "A price list that says “Kubernetes” does not say where etcd and the API server live.",
      ],
      why: "Ask where the control plane lives, who holds the keys, and whether you can export the cluster. That is a sovereignty question, not a Helm-logo question.",
    },
  },
  {
    slug: "ceph",
    kind: "storage",
    name: "Ceph",
    open: true,
    needles: ["ceph"],
    id: {
      title: "Ceph: storage terdistribusi terbuka dengan beban operasi yang nyata",
      lead: "Ceph menyediakan blok, objek, dan berkas dari klaster disk. Sering dipasangkan OpenStack. Beberapa cloud Eropa dan Asia memakainya di belakang S3.",
      what: "OSD, MON, dan MDS membentuk penyimpanan yang bisa tumbuh. RBD untuk disk VM, RGW untuk objek S3-compatible.",
      plus: [
        "Terbuka. Tidak ada lisensi per-TB wajib dari satu vendor hypervisor.",
        "Satu klaster bisa layani VM dan objek.",
        "Bisa dioperasikan di pusat data ASEAN oleh tim lokal.",
      ],
      minus: [
        "Operasi sulit. Klaster kecil rapuh kalau jaringan atau disk tidak dirancang.",
        "Performa butuh perencanaan. Bukan drop-in USB disk.",
      ],
      why: "Ceph adalah fondasi yang bisa dimiliki operator lokal. Itu beda dengan objek S3 yang hanya API di atas penyimpanan tertutup.",
    },
    en: {
      title: "Ceph: open distributed storage with a real operations load",
      lead: "Ceph serves block, object and file from a disk cluster. It often sits under OpenStack. Some European and Asian clouds use it behind S3 APIs.",
      what: "OSDs, monitors and MDS nodes form growable storage. RBD for VM disks, RGW for S3-compatible objects.",
      plus: [
        "Open. No mandatory per-TB licence from one hypervisor vendor.",
        "One cluster can serve VMs and objects.",
        "An ASEAN team can operate it in a local data centre.",
      ],
      minus: [
        "Hard to run. Small clusters are fragile if the network or disks are weak.",
        "Performance needs planning. It is not a drop-in USB disk.",
      ],
      why: "Ceph is a foundation a local operator can own. That differs from an S3 API sitting on closed storage.",
    },
  },
  {
    slug: "minio",
    kind: "storage",
    name: "MinIO",
    open: true,
    needles: ["minio"],
    id: {
      title: "MinIO: object storage kompatibel S3 yang dapat dioperasikan sendiri",
      lead: "MinIO meniru API Amazon S3 di mesin Anda. Berguna agar aplikasi tidak terikat bucket vendor. Di basis data ini, penyedia jarang menulis merek MinIO — banyak yang hanya menulis “S3-compatible”.",
      what: "Server objek open source, sering di-deploy sebagai pasangan Kubernetes. Ada edisi komunitas dan edisi berlangganan.",
      plus: [
        "Aplikasi yang bicara S3 bisa diarahkan ke rak sendiri di ASEAN.",
        "Lebih sederhana dioperasikan daripada Ceph penuh untuk tim kecil.",
        "Membantu strategi “bisa pindah” tanpa menulis ulang aplikasi.",
      ],
      minus: [
        "Kompatibilitas S3 tidak 100% di semua fitur AWS.",
        "Edisi tertentu dan dukungan resmi berbayar.",
        "Nama MinIO jarang muncul di harga VPS. Jangan mengarang bahwa penyedia memakainya.",
      ],
      why: "MinIO adalah alat kedaulatan praktis: API yang sudah dikenal, dijalankan di yurisdiksi Anda. Jika tidak tercatat di penyedia, kami tulis apa adanya.",
    },
    en: {
      title: "MinIO: S3-compatible object storage you can operate yourself",
      lead: "MinIO speaks the Amazon S3 API on machines you control. It helps apps avoid a vendor bucket. In this database, providers rarely name MinIO — many only write “S3-compatible”.",
      what: "An open object server, often deployed next to Kubernetes. There is a community edition and a subscription edition.",
      plus: [
        "An S3-speaking app can point at your own racks in ASEAN.",
        "Simpler to run than full Ceph for a small team.",
        "Supports a “can move” strategy without rewriting the app.",
      ],
      minus: [
        "S3 compatibility is not 100% of every AWS feature.",
        "Some editions and official support are paid.",
        "MinIO rarely appears on VPS price lists. We do not invent that a provider uses it.",
      ],
      why: "MinIO is a practical sovereignty tool: a known API, run under your jurisdiction. If a provider does not list it, we leave the field empty.",
    },
  },
  {
    slug: "object-storage",
    kind: "storage",
    name: "Object storage (S3-compatible)",
    open: false,
    licence: "varies",
    needles: ["s3", "object storage", "object-storage", "spaces"],
    id: {
      title: "Object storage S3-compatible: API serupa, kontrol dan biaya bisa berbeda",
      lead: "Hampir semua cloud menjual object storage bergaya S3. API-nya familiar. Yang menentukan kedaulatan: di negara mana objek disimpan, dan perusahaan mana yang memegang kunci.",
      what: "Objek (bukan disk VM) diakses lewat HTTP API. Cocok untuk cadangan, media, dan data danau kecil.",
      plus: [
        "Murah untuk data dingin dibanding disk VM.",
        "API S3 membuat aplikasi mudah berbicara dengan banyak merek.",
      ],
      minus: [
        "“S3-compatible” bukan berarti data di luar jangkauan hukum negara induk vendor.",
        "Biaya unduh (egress) sering lebih menentukan daripada harga simpan.",
        "Tanpa lokasi bucket yang jelas, Anda tidak tahu yurisdiksi.",
      ],
      why: "Pakai object storage. Tanyakan region bucket dan negara operator. Itu lebih penting daripada logo S3.",
    },
    en: {
      title: "S3-compatible object storage: similar APIs, different control and cost",
      lead: "Almost every cloud sells S3-style object storage. The API is familiar. Sovereignty depends on where objects live and which company holds the keys.",
      what: "Objects (not VM disks) are reached over an HTTP API. Fits backups, media and small data lakes.",
      plus: [
        "Cheaper for cold data than VM disks.",
        "The S3 API lets one app talk to many brands.",
      ],
      minus: [
        "“S3-compatible” does not put data beyond the vendor’s home-country law.",
        "Egress fees often matter more than storage fees.",
        "Without a clear bucket region, you do not know the jurisdiction.",
      ],
      why: "Use object storage. Ask for the bucket region and the operator’s country. That matters more than the S3 logo.",
    },
  },
  {
    slug: "cpanel",
    kind: "control",
    name: "cPanel",
    open: false,
    needles: ["cpanel"],
    id: {
      title: "cPanel: kemudahan mengelola hosting, bukan lapisan kedaulatan",
      lead: "cPanel memudahkan hosting web dan email. Itu bukan hypervisor. Banyak VPS ASEAN menyertakannya sebagai add-on berlisensi.",
      what: "Panel tertutup untuk mengelola situs, surel, dan DNS di atas Linux.",
      plus: [
        "Dikenal banyak teknisi di ASEAN. Pelatihan mudah.",
        "Cukup untuk situs dan surel UKM.",
      ],
      minus: [
        "Lisensi berbayar, tertutup.",
        "Bukan alat kedaulatan. Tidak menggantikan pilihan KVM atau lokasi DC.",
      ],
      why: "cPanel adalah kenyamanan operasional. Skor kedaulatan tidak naik hanya karena ada ikon cPanel.",
    },
    en: {
      title: "cPanel: easier hosting operations, not a sovereignty layer",
      lead: "cPanel makes web and email hosting easier. It is not a hypervisor. Many ASEAN VPS plans add it as a licensed extra.",
      what: "A closed panel for sites, mail and DNS on top of Linux.",
      plus: [
        "Known to many ASEAN technicians. Easy to train.",
        "Enough for SME sites and mail.",
      ],
      minus: [
        "Paid licence, closed source.",
        "Not a sovereignty tool. It does not replace KVM or DC location.",
      ],
      why: "cPanel is operational comfort. The sovereignty score does not rise because a cPanel icon is present.",
    },
  },
  {
    slug: "virtualizor",
    kind: "control",
    name: "Virtualizor",
    open: false,
    needles: ["virtualizor"],
    id: {
      title: "Virtualizor: panel komersial untuk mengelola dan menjual VPS",
      lead: "Virtualizor adalah panel komersial untuk menjual dan mengelola VPS. Sering muncul di penyedia hosting ASEAN.",
      what: "Control plane tertutup yang memutar VM KVM (atau yang lain) dan menagih pelanggan.",
      plus: [
        "Cepat untuk penyedia kecil yang ingin berjualan VPS.",
        "Biasanya duduk di atas KVM terbuka.",
      ],
      minus: [
        "Panelnya tertutup. Anda tergantung vendor panel.",
        "Bukan jaminan kualitas isolasi atau lokasi data.",
      ],
      why: "Kalau yang Anda sewa adalah VPS, tanyakan hypervisor dan negara operator — bukan hanya nama panel.",
    },
    en: {
      title: "Virtualizor: a commercial panel for managing and selling VPS",
      lead: "Virtualizor is a commercial panel for selling and managing VPS. It is common among ASEAN hosting providers.",
      what: "A closed control plane that spins KVM (or other) VMs and bills customers.",
      plus: [
        "Fast path for a small provider that wants to sell VPS.",
        "Usually sits on open KVM.",
      ],
      minus: [
        "The panel is closed. You depend on that vendor.",
        "It does not prove isolation quality or data location.",
      ],
      why: "If you rent a VPS, ask for the hypervisor and the operator’s country — not only the panel name.",
    },
  },
];

export function techBySlug(slug: string) {
  return TECH.find((t) => t.slug === slug) || null;
}

export function techCopy(t: Tech, lang: "id" | "en"): TechCopy {
  return lang === "en" ? t.en : t.id;
}

export function kindLabel(kind: TechKind, lang: "id" | "en") {
  const id: Record<TechKind, string> = {
    hypervisor: "Hypervisor",
    platform: "Platform cloud",
    container: "Kontainer",
    orchestrator: "Orkestrasi",
    storage: "Penyimpanan",
    control: "Panel kendali",
  };
  const en: Record<TechKind, string> = {
    hypervisor: "Hypervisor",
    platform: "Cloud platform",
    container: "Containers",
    orchestrator: "Orchestration",
    storage: "Storage",
    control: "Control panel",
  };
  return (lang === "en" ? en : id)[kind];
}

export function stackBlob(row: {
  hypervisor?: string | null;
  orchestration?: string | null;
  storage?: string | null;
  container_runtime?: string | null;
  control_plane?: string | null;
  virtualization?: string | null;
}) {
  return [row.hypervisor, row.orchestration, row.storage, row.container_runtime, row.control_plane]
    .map(usableField)
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
}

const HEDGE_RE =
  /\b(likely|implied|typical|unknown|confirmed:|sales model|for some services|belum ditemukan|not disclosed|probably|maybe|derived)\b/i;
const EMPTY_RE =
  /^(unknown|n\/?a|not disclosed|undisclosed|none|-|belum ditemukan|tidak diketahui)(\b|$)/i;

/** First-party tech token only. Research notes, hedges, and empty → "". */
export function usableField(value?: string | null) {
  if (!value) return "";
  const v = value.trim();
  if (!v) return "";
  if (EMPTY_RE.test(v)) return "";
  if (HEDGE_RE.test(v)) return "";
  if (v.length > 60) return "";
  return v;
}

export function displayTechField(value?: string | null) {
  return usableField(value);
}

export function techsForBlob(blob: string): Tech[] {
  return TECH.filter((t) => t.needles.some((n) => blob.includes(n)));
}

export function firstTechSlug(blob: string): string | null {
  return techsForBlob(blob)[0]?.slug ?? null;
}

export function techLogo(slug: string) {
  return `/tech-logos/${slug}.svg`;
}

/** Only brand marks that actually belong to the technology. Wrong-brand fallbacks stay unused. */
const OFFICIAL_LOGOS = new Set([
  "proxmox",
  "vmware",
  "hyper-v",
  "nitro",
  "openstack",
  "docker",
  "containerd",
  "kubernetes",
  "ceph",
  "minio",
  "object-storage",
  "cpanel",
]);

export function officialTechLogo(slug: string) {
  return OFFICIAL_LOGOS.has(slug) ? techLogo(slug) : null;
}

export function techMono(name: string) {
  return name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "·";
}

export type TechOrigin = {
  country: string;
  steward: string;
  flags: Array<"us" | "at" | "gb" | "il" | "in">;
  enterprise: "yes" | "no" | "indirect";
  id: { note: string };
  en: { note: string };
};

export const TECH_ORIGIN: Record<string, TechOrigin> = {
  kvm: {
    country: "Israel → global",
    flags: ["il"],
    steward: "Linux kernel; Qumranet (diakuisisi Red Hat, 2008)",
    enterprise: "yes",
    id: { note: "KVM sendiri bagian kernel, bukan SKU. Dukungan enterprise dijual di atasnya: Red Hat, Canonical, SUSE, Oracle Linux." },
    en: { note: "KVM itself is in the Linux kernel, not a SKU. Enterprise support is sold on top by Red Hat, Canonical, SUSE and Oracle Linux." },
  },
  proxmox: {
    country: "Austria",
    flags: ["at"],
    steward: "Proxmox Server Solutions GmbH, Wina",
    enterprise: "yes",
    id: { note: "Perangkat lunak tetap AGPL. Langganan berbayar: repositori enterprise + tiket dukungan, per soket CPU / tahun." },
    en: { note: "The software stays AGPL. Paid subscription: enterprise repository and support tickets, per CPU socket per year." },
  },
  vmware: {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "VMware LLC (Broadcom), Palo Alto",
    enterprise: "yes",
    id: { note: "Produknya memang enterprise: vSphere / VMware Cloud Foundation. Lisensi langganan Broadcom, bukan edisi komunitas." },
    en: { note: "This is the enterprise product: vSphere / VMware Cloud Foundation. Broadcom subscription, not a community edition." },
  },
  "hyper-v": {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "Microsoft",
    enterprise: "yes",
    id: { note: "Termasuk Windows Server dan Azure. Hyper-V Server mandiri dihentikan setelah 2019; jalur enterprise sekarang Windows Server / Azure." },
    en: { note: "Included with Windows Server and Azure. Standalone Hyper-V Server ended after 2019; enterprise path is Windows Server / Azure." },
  },
  xen: {
    country: "Britania Raya",
    flags: ["gb"],
    steward: "Xen Project (Linux Foundation); asal University of Cambridge",
    enterprise: "yes",
    id: { note: "Xen hypervisor terbuka. Edisi enterprise: XenServer (Citrix / Cloud Software Group). AWS dulu memakai Xen sebelum Nitro." },
    en: { note: "The Xen hypervisor is open. Enterprise edition: XenServer (Citrix / Cloud Software Group). AWS used Xen before Nitro." },
  },
  nitro: {
    country: "Amerika Serikat",
    flags: ["us", "il"],
    steward: "Amazon Web Services; perangkat keras Annapurna Labs (Israel, diakuisisi Amazon 2015)",
    enterprise: "indirect",
    id: { note: "Tidak dijual sebagai hypervisor terpisah. Hanya jalan di platform AWS. Tidak ada edisi komunitas Nitro yang setara." },
    en: { note: "Not sold as a standalone hypervisor. It only runs on AWS. There is no equivalent community Nitro edition." },
  },
  openstack: {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "OpenInfra Foundation; asal NASA + Rackspace",
    enterprise: "yes",
    id: { note: "Kode komunitas terbuka. Distro enterprise: Red Hat OpenStack Platform, Canonical OpenStack, Mirantis." },
    en: { note: "Community code is open. Enterprise distros: Red Hat OpenStack Platform, Canonical OpenStack, Mirantis." },
  },
  docker: {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "Docker, Inc., Palo Alto / San Francisco",
    enterprise: "yes",
    id: { note: "Engine komunitas ada. Docker Desktop / Business berbayar untuk organisasi besar. Bisnis Docker Enterprise dijual ke Mirantis (2019)." },
    en: { note: "Community engine exists. Docker Desktop / Business is paid for larger orgs. The old Docker Enterprise business was sold to Mirantis (2019)." },
  },
  containerd: {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "CNCF (asal Docker, disumbangkan 2017)",
    enterprise: "indirect",
    id: { note: "Tidak ada SKU 'containerd Enterprise'. Dipakai di dalam Docker, Kubernetes, dan layanan terkelola." },
    en: { note: "There is no 'containerd Enterprise' SKU. It ships inside Docker, Kubernetes and managed clouds." },
  },
  firecracker: {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "Amazon Web Services (Apache 2.0)",
    enterprise: "no",
    id: { note: "Proyek terbuka. Dipakai di Lambda/Fargate. Tidak ada produk Firecracker Enterprise yang dijual terpisah." },
    en: { note: "Open project. Used inside Lambda/Fargate. No separate Firecracker Enterprise product is sold." },
  },
  kubernetes: {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "CNCF; asal Google (2014)",
    enterprise: "yes",
    id: { note: "Inti proyek terbuka. Distro/layanan enterprise: OpenShift, Rancher, Tanzu, EKS/AKS/GKE, Canonical Kubernetes." },
    en: { note: "Core project is open. Enterprise distros/services: OpenShift, Rancher, Tanzu, EKS/AKS/GKE, Canonical Kubernetes." },
  },
  ceph: {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "Komunitas Ceph; Inktank diakuisisi Red Hat (2014), kini IBM/Red Hat",
    enterprise: "yes",
    id: { note: "Ceph hulu terbuka. Edisi enterprise: Red Hat / IBM Storage Ceph. Canonical dan SUSE juga pernah menjual dukungan." },
    en: { note: "Upstream Ceph is open. Enterprise edition: Red Hat / IBM Storage Ceph. Canonical and SUSE have also sold support." },
  },
  minio: {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "MinIO, Inc., Redwood Shores, California",
    enterprise: "yes",
    id: { note: "AGPL untuk hulu. Langganan Enterprise / AIStor: dukungan SUBNET dan fitur produksi." },
    en: { note: "Upstream is AGPL. Enterprise / AIStor subscription: SUBNET support and production features." },
  },
  "object-storage": {
    country: "Amerika Serikat (API S3)",
    flags: ["us"],
    steward: "Amazon merilis API S3; implementasi banyak pihak",
    enterprise: "indirect",
    id: { note: "Ini protokol, bukan produk. Setiap penyedia (AWS, MinIO, Ceph RGW, Spaces) punya model lisensi sendiri." },
    en: { note: "This is a protocol, not a product. Each implementation (AWS, MinIO, Ceph RGW, Spaces) has its own licence model." },
  },
  cpanel: {
    country: "Amerika Serikat",
    flags: ["us"],
    steward: "cPanel, L.L.C. / WebPros, Houston, Texas",
    enterprise: "yes",
    id: { note: "Perangkat lunak komersial berlisensi. Bukan open source. Paket dijual ke hosting; tidak ada edisi komunitas setara." },
    en: { note: "Commercial licensed software. Not open source. Sold to hosts; no equivalent community edition." },
  },
  virtualizor: {
    country: "India",
    flags: ["in"],
    steward: "Softaculous Ltd., Mumbai",
    enterprise: "yes",
    id: { note: "Panel VPS komersial berlisensi. Dipasarkan untuk perusahaan, tapi itu lisensi produk—bukan fork enterprise dari proyek terbuka." },
    en: { note: "Commercial licensed VPS panel. Marketed to enterprises, but that is a product licence — not an enterprise fork of an open project." },
  },
};

export function techOrigin(slug: string) {
  return TECH_ORIGIN[slug] ?? null;
}
