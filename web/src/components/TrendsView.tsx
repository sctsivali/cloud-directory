"use client";

import { useLang } from "./Language";
import type { TrendReport } from "@/lib/intelligence";
import { TREND_METRICS } from "@/lib/intelligence";

function fmt(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function TrendsView({ report }: { report: TrendReport }) {
  const { t } = useLang();
  return (
    <>
      <p className="kicker">{t.trendsKicker}</p>
      <h1>{t.trendsH1}</h1>
      <p className="lede">{t.trendsLede}</p>
      <p className="section-sub">
        {t.trendsProvenance}: {report.methodologyId} · {report.algorithmVersion} · {report.methodologyHash.slice(0, 12)} · {report.dataRevision}
      </p>
      <p className="section-sub">
        {t.trendsWindow}:{" "}
        {report.windowAvailable && report.observationWindow
          ? `${report.observationWindow.start.slice(0, 10)} → ${report.observationWindow.end.slice(0, 10)}`
          : t.trendsInsufficient}
      </p>
      {TREND_METRICS.map((metric) => {
        const points = report.series[metric];
        const eligibility = report.eligibility[metric];
        const last = points[points.length - 1];
        return (
          <section className="section" key={metric}>
            <h2>{t.trendsMetric}: {metric.split("_").join(" ")}</h2>
            {eligibility.eligible ? (
              <p className="section-sub">
                {fmt(last?.value ?? null)} · n={eligibility.failedGates.length === 0 ? last?.observationCount ?? 0 : last?.observationCount ?? 0}
              </p>
            ) : (
              <p className="section-sub">{t.trendsInsufficient}</p>
            )}
            {!eligibility.eligible && (
              <p className="section-sub">
                {t.outlookGates}: {eligibility.failedGates.map((g) => g.code).join(", ") || t.trendsInsufficient}
              </p>
            )}
            <ol className="rule-list">
              {points.map((point) => (
                <li key={point.period.key}>
                  {point.period.key}: {fmt(point.value)} · obs {point.observationCount}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </>
  );
}
