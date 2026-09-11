# Outlook methodology

Status: Phase 7. Trends and outlooks are derived only from verified published revisions and comparable observations. This document is the public contract for outlook layers, metric-specific evidence gates, and the prohibition on AI-generated forecast publication. No production cutover is authorized here.

## Layers (never collapsed)

Every outlook document keeps these layers distinct:

| Layer | Meaning |
|---|---|
| `observed_fact` | Reconstructed state and counts at the end of each observation period |
| `measured_trend` | Slope and direction computed from the numeric series |
| `signal` | Coded directional reading (`expansion`, `contraction`, `price_pressure`, …) |
| `assessment` | Interpretive summary and caveats |
| `forecast` | Optional OLS projection with residual-derived interval; **null** unless metric gates and a passing minimum-trial backtest both succeed |

Observed facts must not contain forecast point estimates. MCP `directory.get_outlook_eligibility` returns eligibility, confidence label, backtest status, and provenance only. It does not return a forecast payload. When verified facts are absent and the caller does not supply a window, surfaces return **insufficient evidence** and do not invent an observation window.

## Required fields

- Observation window (`start`, `end`)
- Baseline (first period point)
- Supporting and contradicting indicators
- Assumptions
- Confidence interval (when a forecast exists) and confidence label (`insufficient` / `low` / `medium` / `high`)
- Model/ruleset provenance (`asean-trend-series-v1`, algorithm version, SHA-256 ruleset hash, data revision)
- Expiry
- Backtest status (`not_run` / `pass` / `fail` / `insufficient`)

## Metric-specific publication gates

Forecast publication is refused unless **all** metric gates pass. Elapsed calendar days, including a 90-day window, are never sufficient on their own.

Gates consider:

1. Observation count
2. Continuity (share of periods with observations)
3. Comparable population (basket size / distinct entities)
4. Revision quality (verified / (verified + pending + failed + uncertain))
5. Missingness

When any gate fails, or the walk-forward backtest is not `pass` with at least two trials:

- `forecast` is null
- `publication_state` is `insufficient_evidence`
- UI copy is **Insufficient evidence** / **Bukti tidak cukup**
- `refuseForecastPublication` returns `insufficient_evidence`

Observed facts and measured trends remain visible. Eligibility gates alone never emit a forecast.

## Forecast method (`ruleset_ols`)

When gates and backtest both pass, the forecast is ordinary least squares on **all** numeric period points:

1. Time is days from the first numeric period start.
2. Fit `value = intercept + slope_per_day * days`.
3. Project that line to a 90-day horizon after the observation window.
4. The interval is **±1.96 residual standard errors**, where the residual standard error is `sqrt(SSE / (n-2))` of the in-sample residuals. This is a residual-derived band, not a full prediction interval with leverage correction, and it is not the former 10% / 0.5 heuristic. A perfectly linear series may have a zero-width interval.

AI-generated forecasts are always refused (`ai_forecast_forbidden`). There is no MCP publish-forecast tool.

## Reconstruction rules

- Only `verification_state = verified` receipts enter the series.
- Canonical state identity is `(entityType, entityId, fieldName)` plus a truly immutable scope id when needed (`country_presence` uses the declared country code, never a mutable `afterValue`). Country for stock metrics is resolved from the latest value.
- Presence is derived from the resulting knowledge state and new value. Rollback is not automatically absence. Only `retract` or `confirmed_absent` removes stock. A rollback that restores a present value restores stock.
- Pending receipts affect revision quality only.
- Promo / non-comparable prices are excluded from the comparable basket.
- Stale evidence (`valid_to` elapsed) is excluded from coverage; presence stock is unchanged until retracted.
- Conflicting knowledge is counted in `verified_conflicts` and is not treated as present.
- Observation windows are inferred from verified facts or supplied by the caller. An empty ledger does not invent 2025–2026 dates.

## Surfaces

API `/api/trends`, UI `/trends`, `/provider/[id]/timeline`, `/country/[code]`, and MCP read tools call the same engine (`packages/domain/src/intelligence`). Country pages accept canonical ISO 3166-1 alpha-2 codes from `country_registry` only.
