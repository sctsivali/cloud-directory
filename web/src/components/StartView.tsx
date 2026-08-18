"use client";

import { useEffect, useState } from "react";
import { useLang } from "./Language";
import { Icon } from "./Icon";
import {
  COUNTRIES,
  DATA_LEVELS,
  IMPACTS,
  PRIORITIES,
  SECTORS,
  WORKLOADS,
  emptyNeeds,
  extrasFor,
  loadNeeds,
  saveNeeds,
  type NeedsState,
} from "@/lib/needs";

function toggle(list: string[], id: string, max?: number) {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (max && list.length >= max) return list;
  return [...list, id];
}

export function StartView() {
  const { lang, t } = useLang();
  const [state, setState] = useState<NeedsState>(emptyNeeds());
  const [step, setStep] = useState(0);

  useEffect(() => {
    setState(loadNeeds());
  }, []);

  function patch(next: Partial<NeedsState>) {
    setState((prev) => {
      const merged = { ...prev, ...next };
      saveNeeds(merged);
      return merged;
    });
  }

  const extraQs = extrasFor(state.sector);
  const last = 5 + extraQs.length;
  const coreSteps = lang === "en" ? ["Organisation", "Workload", "Impact", "Data", "Country", "Priorities"] : ["Organisasi", "Sistem", "Dampak", "Data", "Negara", "Prioritas"];
  const steps = [...coreSteps, ...extraQs.map((q) => (lang === "en" ? q.enTitle : q.idTitle))];

  return (
    <>
      <p className="kicker">{t.startKicker}</p>
      <h1>{t.startH1}</h1>
      <p className="lede">{t.startLede}</p>
      <p className="section-sub">{t.startPrivacy}</p>
      <p className="meta">
        {lang === "en" ? `Step ${step + 1} of ${steps.length} · about 2 minutes` : `Langkah ${step + 1} dari ${steps.length} · sekitar 2 menit lagi`}
      </p>

      {step === 0 && (
        <section className="section">
          <h2>{t.qOrg}</h2>
          <p className="section-sub">{t.qOrgHelp}</p>
          <div className="city-chips" role="group">
            {SECTORS.map((s) => (
              <button key={s.id} type="button" className={state.sector === s.id ? "active" : ""} onClick={() => patch({ sector: s.id, extras: {} })}>
                {lang === "en" ? s.enLabel : s.idLabel}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="section">
          <h2>{t.qWork}</h2>
          <p className="section-sub">{t.qWorkHelp}</p>
          <div className="city-chips" role="group">
            {WORKLOADS.map((w) => (
              <button
                key={w.id}
                type="button"
                className={state.workloads.includes(w.id) ? "active" : ""}
                onClick={() => patch({ workloads: toggle(state.workloads, w.id, 3) })}
              >
                {lang === "en" ? w.enLabel : w.idLabel}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="section">
          <h2>{t.qImpact}</h2>
          <div className="city-chips" role="group">
            {IMPACTS.map((w) => (
              <button key={w.id} type="button" className={state.impact === w.id ? "active" : ""} onClick={() => patch({ impact: w.id })}>
                {lang === "en" ? w.enLabel : w.idLabel}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="section">
          <h2>{t.qData}</h2>
          <p className="section-sub">{t.qDataHelp}</p>
          <div className="city-chips" role="group">
            {DATA_LEVELS.map((w) => (
              <button key={w.id} type="button" className={state.data === w.id ? "active" : ""} onClick={() => patch({ data: w.id })}>
                {lang === "en" ? w.enLabel : w.idLabel}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="section">
          <h2>{t.qCountry}</h2>
          <div className="city-chips" role="group">
            {COUNTRIES.map((c) => (
              <button key={c} type="button" className={state.countries.includes(c) ? "active" : ""} onClick={() => patch({ countries: toggle(state.countries, c) })}>
                {c}
              </button>
            ))}
            <button type="button" className={state.countries.includes("multi") ? "active" : ""} onClick={() => patch({ countries: toggle(state.countries, "multi") })}>
              {lang === "en" ? "Several countries" : "Lintas beberapa negara"}
            </button>
            <button type="button" className={state.countries.includes("unknown") ? "active" : ""} onClick={() => patch({ countries: toggle(state.countries, "unknown") })}>
              {lang === "en" ? "Not set yet" : "Belum ditentukan"}
            </button>
          </div>
        </section>
      )}

      {step === 5 && (
        <section className="section">
          <h2>{t.qPrio}</h2>
          <div className="city-chips" role="group">
            {PRIORITIES.map((w) => (
              <button
                key={w.id}
                type="button"
                className={state.priorities.includes(w.id) ? "active" : ""}
                onClick={() => patch({ priorities: toggle(state.priorities, w.id, 3) })}
              >
                {lang === "en" ? w.enLabel : w.idLabel}
              </button>
            ))}
          </div>
        </section>
      )}

      {step >= 6 && extraQs[step - 6] && (
        <section className="section">
          <h2>{lang === "en" ? extraQs[step - 6].enTitle : extraQs[step - 6].idTitle}</h2>
          <div className="city-chips" role="group">
            {extraQs[step - 6].options.map((w) => (
              <button
                key={w.id}
                type="button"
                className={state.extras[extraQs[step - 6].key] === w.id ? "active" : ""}
                onClick={() => patch({ extras: { ...state.extras, [extraQs[step - 6].key]: w.id } })}
              >
                {lang === "en" ? w.enLabel : w.idLabel}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="cta-row start-actions">
        {step > 0 ? (
          <button type="button" className="btn-cta ghost start-back" onClick={() => setStep((s) => s - 1)}>
            <span className="btn-ico">
              <Icon name="arrow" size={18} />
            </span>
            {lang === "en" ? "Back" : "Kembali"}
          </button>
        ) : null}
        {step < last ? (
          <button type="button" className="btn-cta" onClick={() => setStep((s) => s + 1)}>
            <span className="btn-ico">
              <Icon name="arrow" size={18} />
            </span>
            {lang === "en" ? "Skip / next" : "Lewati dulu / lanjut"}
          </button>
        ) : (
          <a className="btn-cta" href="/start/result">
            <span className="btn-ico">
              <Icon name="compass" size={18} />
            </span>
            {t.startResultGo}
          </a>
        )}
      </div>
    </>
  );
}
