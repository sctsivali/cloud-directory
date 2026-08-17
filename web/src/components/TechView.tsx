"use client";

import { useLang } from "./Language";
import { Flag } from "./Flag";
import { officialTechLogo, kindLabel, techCopy, techMono, techOrigin } from "@/lib/tech";
import type { Tech } from "@/lib/tech";
import type { TechPlan, TechProvider } from "@/lib/db";

export function TechView({
  tech,
  providers,
  plans,
}: {
  tech: Tech;
  providers: TechProvider[];
  plans: TechPlan[];
}) {
  const { lang, t } = useLang();
  const c = techCopy(tech, lang);
  const origin = techOrigin(tech.slug);
  const ent =
    origin?.enterprise === "yes" ? t.techEntYes : origin?.enterprise === "no" ? t.techEntNo : origin ? t.techEntIndirect : "";
  const shown = plans.slice(0, 24);
  return (
    <>
      <p className="kicker">
        <a href="/tech">{t.techBack}</a>
        {" · "}
        {kindLabel(tech.kind, lang)}
      </p>
      <h1>{c.title}</h1>
      {origin ? (
        <p className="flag-row tech-flags">
          {origin.flags.map((code) => (
            <Flag key={code} code={code} title={origin.country} />
          ))}
          <span className="meta">
            {t.techOrigin}: {origin.country}
          </span>
        </p>
      ) : null}
      <p className="lede">{c.lead}</p>
      <div className="tech-hero-logo">
        <span className="tech-logo-well lg">
          {officialTechLogo(tech.slug) ? (
            <img src={officialTechLogo(tech.slug) || ""} alt={tech.name} width={48} height={48} />
          ) : (
            <span className="tech-mono">{techMono(tech.name)}</span>
          )}
        </span>
      </div>
      <div className="facts">
        <div className="fact">
          <strong>{providers.length}</strong>
          <span>{t.techProviders}</span>
        </div>
        <div className="fact">
          <strong>{tech.licence === "varies" ? t.techVaried : tech.open ? t.techOpen : t.techClosed}</strong>
          <span>{t.techLicence}</span>
        </div>
        {origin ? (
          <>
            <div className="fact">
              <strong className="flag-row">
                {origin.flags.map((code) => (
                  <Flag key={code} code={code} title={origin.country} />
                ))}
                {origin.country}
              </strong>
              <span>{t.techOrigin}</span>
            </div>
            <div className="fact">
              <strong>{ent}</strong>
              <span>{t.techEnterprise}</span>
            </div>
          </>
        ) : null}
      </div>
      {origin ? (
        <p className="section-sub">
          {t.techSteward}: {origin.steward}. {lang === "en" ? origin.en.note : origin.id.note}
        </p>
      ) : null}
      <section className="section">
        <h2>{t.techWhat}</h2>
        <p className="section-sub">{c.what}</p>
      </section>
      <section className="section">
        <div className="grid-2">
          <article className="card">
            <h3>{t.techPlus}</h3>
            <ul className="rule-list">
              {c.plus.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </article>
          <article className="card">
            <h3>{t.techMinus}</h3>
            <ul className="rule-list">
              {c.minus.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </article>
        </div>
        <p className="section-sub">{c.why}</p>
      </section>
      <section className="section">
        <h2>{t.techWho}</h2>
        {providers.length === 0 ? (
          <p className="section-sub">{t.techNone}</p>
        ) : (
          <ol className="list arena-list">
            {providers.map((p, i) => (
              <li key={p.id}>
                <span className="rank">{i + 1}</span>
                <div className="arena-main">
                  <div className="name">
                    <a href={`/provider/${p.id}`}>{p.name}</a>{" "}
                    <span className="pill">{p.hq_country || "—"}</span>
                  </div>
                  <div className="meta">
                    {p.plan_count} {t.pkg}
                    {p.min_price != null ? ` · ${t.from} $${p.min_price.toFixed(2)}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      {shown.length > 0 ? (
        <section className="section">
          <h2>{t.techPlans}</h2>
          <ol className="list arena-list">
            {shown.map((plan, i) => (
              <li key={plan.id}>
                <span className="rank">{i + 1}</span>
                <div className="arena-main">
                  <div className="name">
                    <a href={`/provider/${plan.provider_id}`}>{plan.provider_name}</a>
                  </div>
                  <div className="meta">
                    {plan.tier_name} · {plan.vcpu ?? "—"} vCPU · {plan.ram_gb ?? "—"} GB
                  </div>
                </div>
                <div className="arena-score">
                  <span className="score-label">{t.from}</span>
                  <span className="score">${Number(plan.price_usd_month).toFixed(2)}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
