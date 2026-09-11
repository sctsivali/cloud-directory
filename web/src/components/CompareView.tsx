"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "./Language";
import { Icon } from "./Icon";
import type { ArenaRow } from "@/lib/db";
import { loadCompare, reconcileCompareIds, saveCompare } from "@/lib/needs";
import { displayTechField } from "@/lib/tech";
import { SORT_METRIC_DESCRIPTORS } from "@/lib/scoring";

export function CompareView({ rows }: { rows: ArenaRow[] }) {
  const { lang, t } = useLang();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const stored = loadCompare();
    const next = reconcileCompareIds(
      stored,
      rows.map((r) => r.id)
    );
    setIds(next);
    if (next.join("\0") !== stored.join("\0")) saveCompare(next);
  }, [rows]);
  const selected = useMemo(() => ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as ArenaRow[], [ids, rows]);

  function remove(id: string) {
    const next = ids.filter((x) => x !== id);
    setIds(next);
    saveCompare(next);
  }

  if (selected.length < 2) {
    return (
      <>
        <h1>{t.compareH1}</h1>
        <p className="lede">{t.compareEmpty}</p>
        <div className="cta-row start-actions">
          <a className="btn-cta" href="/arena">
            <span className="btn-ico">
              <Icon name="compare" size={18} />
            </span>
            {t.navCompare}
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="kicker">{t.compareNav}</p>
      <h1>{t.compareH1}</h1>
      <p className="section-sub">{t.screenBanner}</p>
      {selected.some((r) => r.score_engine === "legacy-fallback") ? (
        <p className="section-sub">{t.scoreEngineLegacy}</p>
      ) : null}
      <div className="city-grid">
        {selected.map((r) => (
          <article className="card" key={r.id}>
            <h3>
              <a href={`/provider/${r.id}`}>{r.name}</a>
            </h3>
            <p className="meta">
              {t.provHq}: {r.hq_country || "—"}
            </p>
            <p className="meta">
              {SORT_METRIC_DESCRIPTORS.sov.labels[lang]} {r.sov_score} · {SORT_METRIC_DESCRIPTORS.oss.labels[lang]}{" "}
              {r.oss_score} · {SORT_METRIC_DESCRIPTORS.conf.labels[lang]} {r.conf_score}
            </p>
            <p className="meta">
              {t.colHv}: {displayTechField(r.hypervisor) || t.hvUnknown}
            </p>
            <p className="meta">
              {t.from} {r.min_price != null ? `$${r.min_price.toFixed(2)}` : "—"}
            </p>
            <p className="meta">{t.unknownHint}</p>
            <button type="button" className="map-cable-btn" onClick={() => remove(r.id)}>
              {t.resultClear}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
