"use client";

import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { useLang } from "./Language";
import type { BuildingRow } from "@/lib/db";

const ASEAN = ["Indonesia", "Vietnam", "Malaysia", "Singapore", "Thailand", "Philippines"];

export function BuildingsView({ rows }: { rows: BuildingRow[] }) {
  const { t } = useLang();
  const [scope, setScope] = useState<"listed" | "all">("listed");
  const [country, setCountry] = useState("all");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (scope === "listed" && !r.listed) return false;
      if (country !== "all" && r.country !== country) return false;
      return true;
    });
  }, [rows, scope, country]);

  return (
    <>
      <p className="kicker">{t.bldgKicker}</p>
      <h1>{t.bldgH1}</h1>
      <p className="lede">{t.bldgLede}</p>

      <div className="toolbar">
        <div className="scope" role="group">
          <button type="button" className={scope === "listed" ? "active" : ""} onClick={() => setScope("listed")}>
            {t.bldgListed}
          </button>
          <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>
            {t.filterAll}
          </button>
        </div>
      </div>
      <div className="city-chips" role="group" aria-label={t.filterCountry}>
        <button type="button" className={country === "all" ? "active" : ""} onClick={() => setCountry("all")}>
          {t.filterAll}
        </button>
        {ASEAN.map((c) => (
          <button key={c} type="button" className={country === c ? "active" : ""} onClick={() => setCountry(c)}>
            {c}
          </button>
        ))}
      </div>
      <p className="meta">
        {filtered.length} {t.nShown}
      </p>

      {filtered.length === 0 ? (
        <p className="section-sub">{t.empty}</p>
      ) : (
        <ol className="bldg-cards">
          {filtered.map((b) => (
            <li key={b.id}>
              <a className="bldg-card" href={`/building/${b.id}`}>
                <span className={b.photo_path ? "bldg-media" : "bldg-media empty"}>
                  {b.photo_path ? (
                    <img src={b.photo_path} alt="" />
                  ) : (
                    <Icon name="building" size={22} />
                  )}
                </span>
                <span className="bldg-body">
                  <span className="name">
                    {b.name} {b.listed ? <span className="pill">DC</span> : null}
                  </span>
                  <span className="meta">
                    {b.city}, {b.country}
                    {b.operator ? ` · ${b.operator}` : ""}
                  </span>
                  {b.address ? <span className="meta">{b.address}</span> : null}
                </span>
                <span className="arena-score">
                  <span className="score-label">{t.bldgProviders}</span>
                  <span className="score">{b.provider_count}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
