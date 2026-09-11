# Scoring shadow report template

Status: Phase 5. This report is comparison evidence. It does not authorize replacing public Arena, wizard, or API ranking.

## Identity

| Field | Value |
|---|---|
| Data revision | _fill from run_ |
| Methodology id | `asean-offering-deployment-v1` |
| Algorithm version | `1.0.0` |
| Ruleset hash | _64-hex from `CURRENT_METHODOLOGY.rulesetHash`_ |
| Engine | `canonical` or labeled `legacy-fallback` |

## How to generate

From the repository root, fixture-only, no production database:

```bash
node --experimental-strip-types scripts/compare_scoring_versions.ts
node --experimental-strip-types scripts/compare_scoring_versions.ts --out=/tmp/scoring-shadow.md
```

## Columns

| Column | Meaning |
|---|---|
| Legacy SOV / OSS / CONF | Frozen provider-level regex/presence scores |
| New composite | Offering/deployment engine composite on known dimensions only, or `—` when all dimensions are unknown / fallback |
| Ranking lower bound | Uncertainty-adjusted order key (unknown/conflicting treated as 0 for ranking only) |
| Engine | `canonical` when an offering/deployment subject exists; otherwise `legacy-fallback` |
| Group | `eligible` / `needs_verification` / `excluded`. Readiness can move a no-hard-fail subject to `needs_verification`. |
| Change | Reason the order or value differs from legacy |
| Reasons | Engine reason codes (unknown, confirmed_absent, conflicting, constraints, fallback) |

## Review rule

Material ranking changes stay in shadow until editorial review. Do not cut over public ranking from this file alone.
