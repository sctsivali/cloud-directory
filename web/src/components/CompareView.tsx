"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "./Language";
import type { ArenaRow } from "@/lib/db";
import { loadCompare, saveCompare } from "@/lib/needs";

export function CompareView({ rows }: { rows: ArenaRow[] }) {
  const { t } = useLang();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    setIds(loadCompare());
  }, []);
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
        <p>
          <a className="go" href="/arena">
            {t.navCompare}
          </a>
        </p>
      </>
    );
  }

  return (
    <>
      <p className="kicker">{t.compareNav}</p>
      <h1>{t.compareH1}</h1>
      <p className="section-sub">{t.screenBanner}</p>
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
              {t.scoreSov} {r.sov_score} · {t.scoreOss} {r.oss_score} · {t.scoreConf} {r.conf_score}
            </p>
            <p className="meta">
              {t.colHv}: {r.hypervisor || t.hvUnknown}
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
