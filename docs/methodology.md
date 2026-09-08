# Methodology

Status: Phase 5 introduces the versioned offering/deployment engine `asean-offering-deployment-v1` (algorithm `1.0.0`) in `packages/domain/src/scoring`. Arena, wizard, compare, provider, methodology, and MCP `directory.explain_score` share that engine. When canonical offering/deployment data is unavailable, those surfaces show a **clearly labeled legacy fallback** (`legacy-fallback`). Captured SOV/CONF/OSS outputs remain comparison evidence, not the accepted behavior of the new engine. Public ranking is not cut over from the shadow report alone.

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

## Canonical engine (in force for explanations; public list still may fall back)

Dimensions (unknown is not zero; confirmed_absent is a known 0; conflicting is null + uncertainty):

1. Primary-data residency
2. Backup residency
3. Metadata / control-plane residency
4. Contracting entity and legal control
5. Administrative access and key control
6. Evidence coverage
7. Evidence quality
8. Open technology and portability
9. Commercial comparability

Every explanation includes components, reason codes, uncertainty, an uncertainty-adjusted `rankingLowerBound`, algorithm version, ruleset hash, and data revision. Composite stays the weighted mean of **known** dimensions only; unknown is not scored as zero. `rankingLowerBound` is the same weighted sum over all applicable dimensions with unknown/conflicting treated as 0 for ordering only.

Ties break by recommendation group, ranking lower bound, composite, uncertainty, evidence coverage, then offering/deployment/provider id. `eligible` always ranks before `needs_verification`.

Evidence coverage intersects observed claim types with `methodology.requiredEvidenceClaimTypes`. Irrelevant evidence cannot inflate coverage.

Evidence quality never credits conflicting items. Material conflict (required claim types, or a conflicting share at/above the versioned threshold) sets quality to conflicting/null and, when quality is a critical dimension, `needs_verification` with `EVIDENCE_CONFLICT` / `CRITICAL_DIMENSION_CONFLICTING`.

Open-technology scoring uses the `openTechnologySlugs` on the methodology passed into `scoreOfferingDeployment`, not a process-global list.

Recommendation groups: `eligible`, `needs_verification`, `excluded`. Country, legal entity, facility, and residency hard constraints evaluate the offering/deployment subject and never silently relax.

Evidence-readiness (versioned on the ruleset, part of the ruleset hash): a subject that did not hard-fail is placed in `needs_verification` when a critical dimension is unknown or conflicting, or when required-evidence coverage is below `minCoverage`.

Shadow comparison: `scripts/compare_scoring_versions.ts` and `docs/reports/scoring-shadow-template.md`.

Outlooks stay out of this document until there is longitudinal evidence.
