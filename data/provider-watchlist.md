# Provider coverage before 24h scrape

Rule: find first. Do not insert empty rows. Do not invent prices or halls.
Daily scrape (24h) starts only after ingest gate + one dry-run.

## Already in Guide (18 Aug 2026)

- 98 providers, 29 marked local ASEAN
- Indonesia 12 · Malaysia 6 · Vietnam 11
- Thailand 0 local · Philippines 0 · Singapore 0 local

Malaysia includes `shinjiru` + `shinjiru_vps` (same site) and two with no first-party site (Server Connect, SiteDotNet).

## Must add (public IaaS/VPS, official site exists)

| Priority | Name | Country | Official URL | Why |
|---|---|---|---|---|
| P0 | Nevacloud | ID | https://nevacloud.com/harga/ | Local KVM VPS, public IDR |
| P0 | Eranyacloud | ID | https://eranyacloud.com/en/ | Local public cloud, DC Indonesia |
| P0 | JetOrbit Cloud VPS | ID | https://www.jetorbit.com/cloud-vps/ | NVMe VPS, ID + SG written |
| P0 | Cloudmatika | ID | https://cloudmatika.co.id/en/cloud-vps/ | Local Cloud VPS |
| P0 | AWS Asia Pacific | US | https://aws.amazon.com/ | SG + Jakarta regions official; DB only has Africa/Bahrain stubs |
| P0 | Google Cloud Asia | US | https://cloud.google.com/about/locations | SG + Jakarta + Bangkok official; DB only has Qatar/UAE |
| P1 | CMC Cloud | VN | https://www.cmccloud.vn/ or CMC Telecom | VN IaaS, missing beside Viettel/FPT/VNG |
| P1 | Bangmod.Cloud | TH | https://bangmod.cloud/ | First Thailand local with a live site |
| P1 | ReadySpace | SG | https://readyspace.com.sg/ | First Singapore local VPS/cloud |

## Hyperscaler already listed but incomplete

- Azure: official Jakarta/SG/KL cities exist; SKUs still Hong Kong
- Vultr: official Singapore city exists; SKUs still New York
- Do **not** invent SKU prices. Refresh from official calculators/tables.

## Do not add (this pass)

- Shared hosting only (Warnahost, Hostingan, Dhyhost, …)
- Sumopod (template marketplace, not IaaS)
- Niagahoster (merged into Hostinger)
- CBN Cloud / old Cloudeka.co.id (DNS dead)
- Neutron (site broken)
- True IDC Thailand (DNS fail)
- Europe-only with no ASEAN region
- Contact-sales enterprise with no public tiers (unless we store city/legal only)

## 24h job (later)

1. Ingest gate (validate JSONL → upsert Postgres, never truncate)
2. Dry-run one P0 provider on live Guide
3. Then cron every 24h, ASEAN locals first, Semanan-safe (no Playwright flood)
