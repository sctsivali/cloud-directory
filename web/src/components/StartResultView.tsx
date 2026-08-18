"use client";

import { useEffect, useState } from "react";
import { useLang } from "./Language";
import { Icon } from "./Icon";
import { arenaHref, clearNeeds, deriveNeeds, emptyNeeds, loadNeeds, type DerivedNeeds, type NeedsState } from "@/lib/needs";

export function StartResultView() {
  const { lang, t } = useLang();
  const [state, setState] = useState<NeedsState>(emptyNeeds());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(loadNeeds());
    setReady(true);
  }, []);

  if (!ready) return null;
  const derived: DerivedNeeds = deriveNeeds(state);
  const href = arenaHref(derived);

  return (
    <>
      <p className="kicker">{t.resultKicker}</p>
      <h1>{t.resultH1}</h1>
      <p className="lede">{lang === "en" ? derived.summary.en : derived.summary.id}</p>
      {derived.highImpact ? <p className="section-sub">{t.screenBanner}</p> : null}

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
        <a className="btn-cta" href={href}>
          <span className="btn-ico">
            <Icon name="compare" size={18} />
          </span>
          {t.resultArena}
        </a>
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
