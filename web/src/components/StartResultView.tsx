"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "./Language";
import { Icon } from "./Icon";
import { Flag, flagForCountry } from "./Flag";
import type { ArenaRow } from "@/lib/db";
import {
  arenaHref,
  clearNeeds,
  deriveNeeds,
  emptyNeeds,
  loadCompare,
  loadNeeds,
  saveCompare,
  shortlistProviders,
  type DerivedNeeds,
  type NeedsState,
} from "@/lib/needs";

export function StartResultView({ rows }: { rows: ArenaRow[] }) {
  const { lang, t } = useLang();
  const [state, setState] = useState<NeedsState>(emptyNeeds());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(loadNeeds());
    setReady(true);
  }, []);

  const derived: DerivedNeeds = useMemo(() => deriveNeeds(state), [state]);
  const href = arenaHref(derived);
  const picks = useMemo(() => (ready ? shortlistProviders(rows, derived, 4) : []), [ready, rows, derived]);

  useEffect(() => {
    if (!ready || picks.length === 0) return;
    if (loadCompare().length === 0) saveCompare(picks.map((p) => p.id));
  }, [ready, picks]);

  if (!ready) return null;

  const scoreOf = (r: (typeof picks)[number]) => {
    if (derived.sort === "oss") return r.oss_score;
    if (derived.sort === "conf") return r.conf_score;
    if (derived.sort === "cost") return r.min_price;
    if (derived.sort === "cover") return r.loc_count;
    return r.sov_score;
  };

  return (
    <>
      <p className="kicker">{t.resultKicker}</p>
      <h1>{t.resultH1}</h1>
      <p className="lede">{lang === "en" ? derived.summary.en : derived.summary.id}</p>
      {derived.highImpact ? <p className="section-sub">{t.screenBanner}</p> : null}

      <section className="section">
        <h2>{t.resultShort}</h2>
        <p className="section-sub">{t.resultShortHelp}</p>
        {picks.length === 0 ? (
          <p className="section-sub">{lang === "en" ? derived.why.en : derived.why.id}</p>
        ) : (
          <ol className="list arena-list">
            {picks.map((r, i) => {
              const score = scoreOf(r);
              return (
                <li key={r.id}>
                  <span className="rank">{i + 1}</span>
                  <div className="arena-main">
                    <div className="name">
                      <a href={`/provider/${r.id}`}>{r.name}</a>
                    </div>
                    <div className="meta">
                      {r.hq_country ? (
                        <>
                          {flagForCountry(r.hq_country) ? <Flag code={flagForCountry(r.hq_country)!} title={r.hq_country} /> : null} {r.hq_country}
                        </>
                      ) : (
                        "—"
                      )}
                      {r.min_price != null ? ` · ${t.from} $${r.min_price.toFixed(2)}` : ""}
                    </div>
                    <div className="meta">{lang === "en" ? derived.why.en : derived.why.id}</div>
                  </div>
                  <div className="arena-score">
                    <span className="score-label">{derived.sort === "cost" ? `${t.from} USD/bln` : t.scoreSov}</span>
                    <span className="score">
                      {score == null ? "—" : derived.sort === "cost" ? `$${Number(score).toFixed(2)}` : score}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="section">
        <h2>{t.resultPri}</h2>
        <ul className="rule-list">
          {(lang === "en" ? derived.priorities.map((p) => p.en) : derived.priorities.map((p) => p.id)).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
      <section className="section">
        <h2>{t.resultUnk}</h2>
        {derived.unknowns.length === 0 ? (
          <p className="section-sub">{t.resultUnkNone}</p>
        ) : (
          <ul className="rule-list">
            {(lang === "en" ? derived.unknowns.map((p) => p.en) : derived.unknowns.map((p) => p.id)).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="section">
        <h2>{t.resultVal}</h2>
        <ul className="rule-list">
          {(lang === "en" ? derived.validate.map((p) => p.en) : derived.validate.map((p) => p.id)).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
      <section className="section">
        <h2>{t.resultCheck}</h2>
        <ul className="rule-list">
          {(lang === "en" ? derived.checklist.map((p) => p.en) : derived.checklist.map((p) => p.id)).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
      <div className="cta-row start-actions">
        {picks.length >= 2 ? (
          <a className="btn-cta" href="/compare">
            <span className="btn-ico">
              <Icon name="compare" size={18} />
            </span>
            {t.resultCompare}
          </a>
        ) : (
          <a className="btn-cta" href={href}>
            <span className="btn-ico">
              <Icon name="compare" size={18} />
            </span>
            {t.resultArena}
          </a>
        )}
        {picks.length >= 2 ? (
          <a className="btn-cta ghost" href={href}>
            <span className="btn-ico">
              <Icon name="list" size={18} />
            </span>
            {t.resultArena}
          </a>
        ) : null}
        <a className="btn-cta ghost" href="/start">
          <span className="btn-ico">
            <Icon name="sliders" size={18} />
          </span>
          {t.resultEdit}
        </a>
      </div>
      <p>
        <button
          type="button"
          className="map-cable-btn"
          onClick={() => {
            clearNeeds();
            setState(emptyNeeds());
          }}
        >
          {t.resultClear}
        </button>
      </p>
      <p className="meta">{t.resultSaved}</p>
    </>
  );
}
