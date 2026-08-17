"use client";

import { Icon } from "./Icon";
import { useLang } from "./Language";
import { firstTechSlug, stackBlob } from "@/lib/tech";
import type { ProviderDetail } from "@/lib/db";

export function ProviderView({ data }: { data: ProviderDetail }) {
  const { t } = useLang();
  const hvSlug = firstTechSlug(stackBlob({ hypervisor: data.hypervisor, orchestration: data.orchestration, storage: data.storage }));
  return (
    <>
      <p className="kicker">
        <a href="/arena">{t.provBack}</a>
      </p>
      <h1>{data.name}</h1>
      <p className="lede">
        {t.provHq}: {data.hq_country || "—"}
        {data.legal_country && data.legal_country !== data.hq_country
          ? ` · ${t.provLegal}: ${data.legal_country}`
          : ""}
        {data.is_local_asean ? ` · ${t.scopeAsean}` : ""}
        {data.provider_type && !/commercial|strong|high/i.test(data.provider_type) ? ` · ${data.provider_type}` : ""}
      </p>
      <p className="section-sub">
        {t.beginnerKnown}: {data.hq_country || "—"}
        {data.hypervisor ? ` · ${data.hypervisor.split("(")[0].trim()}` : ""}
        {data.source_url ? ` · ${t.fieldSrc}` : ""}. {t.beginnerUnknown}:{" "}
        {[!data.hypervisor ? t.fieldHv : "", !data.cities.some((c) => c.listed) ? t.fieldBldg : "", !data.source_url ? t.fieldSrc : ""]
          .filter(Boolean)
          .join(" · ") || t.resultUnkNone}
      </p>
      <div className="facts">
        <div className="fact">
          <strong>{data.sov_score}</strong>
          <span>{t.provSov}</span>
        </div>
        <div className="fact">
          <strong>{data.oss_score}</strong>
          <span>{t.provOss}</span>
        </div>
        <div className="fact">
          <strong>{data.tiers.length}</strong>
          <span>{t.provPlans}</span>
        </div>
        <div className="fact">
          <strong>{data.conf_score}</strong>
          <span>{t.scoreConf}</span>
        </div>
      </div>
        <p className="section-sub">{t.scoreDisclaimer}</p>
        {data.legal_note ? <p className="section-sub">{data.legal_note}</p> : null}

      <section className="section">
        <h2>{t.provEvidence}</h2>
        <p className="section-sub">{t.lastUpdated}</p>
        <div className="city-grid">
          <div className="city">
            <b>{t.fieldHq}</b>
            <span>
              {data.hq_country || t.evUnknown} · {data.hq_country ? t.evClaimed : t.evUnknown}
            </span>
          </div>
          <div className="city">
            <b>{t.fieldHv}</b>
            <span>
              {(data.hypervisor || t.evUnknown).split("(")[0].trim()} ·{" "}
              {!data.hypervisor
                ? t.evUnknown
                : /likely|implied|typical|unknown/i.test(data.hypervisor)
                  ? t.evInferred
                  : t.evClaimed}
            </span>
          </div>
          <div className="city">
            <b>{t.fieldSrc}</b>
            <span>
              {data.source_url ? (
                <a href={data.source_url.split(",")[0].trim().startsWith("http") ? data.source_url.split(",")[0].trim() : `https://${data.source_url.split(",")[0].trim()}`} rel="noopener noreferrer">
                  {t.openSource}
                </a>
              ) : (
                t.evUnknown
              )}
            </span>
          </div>
          <div className="city">
            <b>{t.fieldBldg}</b>
            <span>{data.cities.some((c) => c.listed) ? t.evClaimed : t.evUnknown}</span>
          </div>
          <div className="city">
            <b>{t.fieldDc}</b>
            <span>{data.tiers.some((x) => x.dc_country) ? t.evClaimed : t.evUnknown}</span>
          </div>
        </div>
        <p>
          <a className="go" href="/correct">
            {t.navCorrect}
          </a>
        </p>
      </section>

      <section className="section">
        <h2>{t.provStack}</h2>
        <div className="city-grid">
          <div className="city">
            <b>Hypervisor</b>
            <span>
              {hvSlug ? <a href={`/tech/${hvSlug}`}>{data.hypervisor}</a> : data.hypervisor || t.hvUnknown}
            </span>
          </div>
          <div className="city">
            <b>Orkestrasi</b>
            <span>{data.orchestration || "—"}</span>
          </div>
          <div className="city">
            <b>Storage</b>
            <span>{data.storage || "—"}</span>
          </div>
          <div className="city">
            <b>Control plane</b>
            <span>{data.control_plane || "—"}</span>
          </div>
        </div>
        {data.sea_strength && !/strong|high/i.test(data.sea_strength) ? <p className="section-sub">{data.sea_strength}</p> : null}
      </section>

      <section className="section">
        <h2>{t.provCities}</h2>
        {data.cities.length === 0 ? (
          <p className="section-sub">—</p>
        ) : (
          <div className="city-grid">
            {data.cities.slice(0, 24).map((c) => (
              <div className="city" key={`${c.building}-${c.city}-${c.country}`}>
                <b>
                  <a href={`/building/${c.id}`}>{c.building}</a>
                </b>
                <span>
                  {c.city}, {c.country}
                  {c.operator ? ` · ${c.operator}` : ""}
                  {c.address ? ` · ${c.address}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>{t.provPlans}</h2>
        {data.tiers.length === 0 ? (
          <p className="section-sub">{t.noPlans}</p>
        ) : (
          <ol className="list arena-list">
            {data.tiers.map((tier) => (
              <li key={tier.id}>
                <span className="rank">{tier.vcpu ?? "—"}</span>
                <div className="arena-main">
                  <div className="name">{tier.tier_name}</div>
                  <div className="meta">
                    {tier.dc_location || tier.dc_city || "—"}
                    {tier.dc_country ? ` · ${tier.dc_country}` : ""}
                    {tier.currency ? ` · ${tier.currency}` : ""}
                    {tier.cpu_family ? ` · ${tier.cpu_family}` : ""}
                    {` · ${tier.ram_gb ?? "—"} GB`}
                  </div>
                  <div className="meta">
                    {tier.hypervisor
                      ? firstTechSlug(stackBlob({ hypervisor: tier.hypervisor }))
                        ? (
                            <a href={`/tech/${firstTechSlug(stackBlob({ hypervisor: tier.hypervisor }))}`}>
                              {tier.hypervisor.split("(")[0].trim()}
                            </a>
                          )
                        : tier.hypervisor.split("(")[0].trim()
                      : t.hvUnknown}
                    {tier.orchestration ? ` · ${tier.orchestration.split("(")[0].trim()}` : ""}
                    {tier.container_runtime ? ` · ${tier.container_runtime.split(",")[0].trim()}` : ""}
                  </div>
                  <div className="meta">
                    {t.provSov} {tier.sov_score ?? "—"} · {t.provOss} {tier.oss_score ?? "—"}
                    {tier.price_native ? ` · ${tier.price_native}` : ""}
                  </div>
                </div>
                <div className="arena-score">
                  <span className="score-label">{t.from} USD/bln</span>
                  <span className="score">${Number(tier.price_usd_month).toFixed(2)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p>
          <a className="go" href="/arena">
            {t.provBack} <Icon name="arrow" size={16} />
          </a>
        </p>
      </section>
    </>
  );
}
