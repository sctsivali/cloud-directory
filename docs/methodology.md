# Methodology (legacy baseline)

Status: Phase 2 does not change public indicators. Version label on the site remains editorial copy, not a stored `methodology_versions` row. Canonical claim/evidence tables exist but are not inputs to SOV, CONF, OSS, Arena, or the wizard.

These formulas are implemented in `web/src/lib/legacy-scoring.ts` and executed in PostgreSQL via `web/src/lib/db.ts`. Wizard derivation and shortlisting live in `web/src/lib/needs.ts`. Captured outputs in `tests/fixtures/legacy-scores.json` and `tests/fixtures/legacy-shortlists.json` are comparison evidence. They are not the accepted behavior of the future engine.

## What the current indicators claim

| Code | Public name | Production path |
|---|---|---|
| SOV | Control & residency | Presence of an ASEAN named city, ASEAN legal/HQ, legal-country matching an OK plan DC country, listed building |
| CONF | Evidence quality | HQ, hypervisor text, listed building, any named plan city, any source URL, legal country |
| OSS | Open technology | Regex on provider-level stack fields |
| Arena cost / cover / perf | Display sorts | `min(price_usd_month)` on OK plans; distinct location count; max vCPU/RAM |
| Wizard | Start result | `deriveNeeds` then `shortlistProviders` |

## Legacy SOV (0–100)

- +40 if an OK plan has a named ASEAN `dc_city`, or a provider location has a named ASEAN city. Empty / Undisclosed / Unknown / Not disclosed does not count.
- +25 if `legal_country` (or HQ when legal is empty) is in the SQL ASEAN list.
- +15 if ASEAN `legal_country` equals an OK plan’s `dc_country` and that plan has a named city.
- +20 if any linked building is `listed`.

SQL ASEAN list: Indonesia, Malaysia, Singapore, Thailand, Vietnam, Philippines, Cambodia, Laos, Myanmar, Brunei. Timor-Leste is not included.

## Legacy CONF (0–100)

- +20 if HQ country is non-empty.
- +20 if hypervisor text is non-empty, ≤60 characters after trim, and does not match the hedge regex (`likely|implied|typical|unknown|confirmed:|not disclosed|belum ditemukan|sales model|derived`). Otherwise 0. Site copy that says “implied = 10” does not match this SQL.
- +15 if a listed building exists.
- +15 if any tier (status not required) has a named city and a non-empty DC country.
- +15 if any source row has a non-empty URL. HTTP status is ignored.
- +15 if legal country is non-empty.

## Legacy OSS (0–100)

- +30 if hypervisor matches `kvm|proxmox|xen` (substring, unanchored).
- +20 if orchestration matches `kubernetes|k8s|docker`.
- +20 if storage matches `ceph|openebs|longhorn|rook`.
- +15 if `open_source IS TRUE`.
- +15 if control plane matches `proxmox|openstack`. Virtualizor is not credited here, despite one English methodology string.

## Wizard and Arena

`deriveNeeds` chooses sort (`sov` / `oss` / `conf` / `cost` / `perf`), scope (`asean` / `all`), and a single-country HQ filter.

`shortlistProviders` filters to `is_local_asean` when scope is ASEAN. If a single country is set and fewer than two headquarters match, it keeps the wider list. That relaxation is a captured defect, not a future rule.

`rankArenaRows` uses the same sort keys but never relaxes the country filter.

Compare only displays SOV, OSS, CONF, HQ, hypervisor, and min price for selected ids. It does not re-rank.

## Honest limits of this baseline

1. Unknown is scored like absence (usually 0).
2. HTTP success is not verification; a URL is enough for CONF.
3. Provider-level stack and scores are applied as if they described every offering.
4. Promo, annual commitment, and list price share one USD-month column. Unsupported currency uses the IDR FX fallback.
5. Hedged or negated “KVM” text can still receive OSS credit because the matcher is an unanchored substring.
6. ASEAN membership differs between SQL scoring, wizard country lists, and Arena filter chips.
7. Replay/import time is not separated from observation time.

## Target methodology (not in force)

The future engine must keep unknown distinct from false and from confirmed absence; evaluate residency, legal control, and technology on the relevant offering or deployment; refuse silent constraint relaxation; and version every public score against a data revision and methodology id. Outlooks stay out of this document until there is longitudinal evidence.
