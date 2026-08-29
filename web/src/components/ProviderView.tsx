"use client";

import { Icon } from "./Icon";
import { useLang } from "./Language";
import { firstTechSlug, displayTechField, stackBlob } from "@/lib/tech";
import type { ProviderDetail } from "@/lib/db";

function techLink(value: string | null | undefined, fallback: string) {
  const shown = displayTechField(value);
  if (!shown) return fallback;
  const slug = firstTechSlug(
    stackBlob({ hypervisor: shown, orchestration: shown, storage: shown, container_runtime: shown, control_plane: shown })
  );
  return slug ? <a href={`/tech/${slug}`}>{shown}</a> : shown;
}

export function ProviderView({ data }: { data: ProviderDetail }) {
  const { t } = useLang();
  const hv = displayTechField(data.hypervisor);
  const runtime = displayTechField(data.container_runtime);
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
        {hv ? ` · ${hv}` : ""}
        {data.source_url ? ` · ${t.fieldSrc}` : ""}. {t.beginnerUnknown}:{" "}
        {[!hv ? t.fieldHv : "", !data.cities.some((c) => c.listed) ? t.fieldBldg : "", !data.source_url ? t.fieldSrc : ""]
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
        {data.legal_country === "United States" ? <p className="risk-banner">{t.riskBannerUs}</p> : null}
        {data.legal_country === "China" ? <p className="risk-banner">{t.riskBannerCn}</p> : null}
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
              {hv || t.hvUnknown} ·{" "}
              {!hv ? t.evUnknown : t.evClaimed}
            </span>
          </div>
          <div className="city">
            <b>{t.fieldSrc}</b>
            <span>
              {data.sources.length > 0 ? (
                <a
                  href={data.sources[0].url}
                  rel="noopener noreferrer"
                >
                  {t.evVerified}
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
            <span>
              {data.tiers.some((x) => x.dc_city && x.dc_city !== "Undisclosed")
                ? t.evClaimed
                : t.evUnknown}
            </span>
          </div>
        </div>
        {data.sources.length > 0 ? (
          <ul className="section-sub" style={{ listStyle: "none", padding: 0 }}>
            {data.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} rel="noopener noreferrer">
                  {s.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
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
            <b>{t.stackHv}</b>
            <span>{techLink(data.hypervisor, t.hvUnknown)}</span>
          </div>
          <div className="city">
            <b>{t.stackOrch}</b>
            <span>{techLink(data.orchestration, t.hvUnknown)}</span>
          </div>
          <div className="city">
            <b>{t.stackStor}</b>
            <span>{techLink(data.storage, t.hvUnknown)}</span>
          </div>
          <div className="city">
            <b>{t.stackCp}</b>
            <span>{techLink(data.control_plane, t.hvUnknown)}</span>
          </div>
          {runtime ? (
            <div className="city">
              <b>{t.stackRuntime}</b>
              <span>{techLink(data.container_runtime, t.hvUnknown)}</span>
            </div>
          ) : null}
        </div>
        {data.sea_strength && !/strong|high/i.test(data.sea_strength) ? <p className="section-sub">{data.sea_strength}</p> : null}
      </section>

      <section className="section">
        <h2>{t.provCities}</h2>
        {data.cities.length === 0 ? (
          <p className="section-sub">{t.undisclosedBuilding}</p>
        ) : (
          <div className="city-grid">
            {data.cities.slice(0, 24).map((c) => {
              const title = c.listed ? c.building : c.city || t.undisclosedBuilding;
              const sub = c.listed
                ? [c.city, c.country, c.operator, c.address].filter(Boolean).join(" · ")
                : [t.undisclosedBuilding, c.country].filter(Boolean).join(" · ");
              return (
                <div className="city" key={`${c.building}-${c.city}-${c.country}`}>
                  <b>{c.listed && c.id ? <a href={`/building/${c.id}`}>{title}</a> : title}</b>
                  <span>{sub}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <h2>{t.provPlans}</h2>
        {data.tiers.length === 0 ? (
          <p className="section-sub">{t.noPlans}</p>
        ) : (
          <ol className="list arena-list">
            {data.tiers.map((tier, i) => {
              const cityLine =
                tier.dc_city === "Undisclosed" || tier.dc_location === "Undisclosed building"
                  ? t.undisclosedBuilding
                  : [tier.dc_city || tier.dc_location, tier.dc_country].filter(Boolean).join(" · ") || t.undisclosedBuilding;
              const specs = [
                tier.vcpu != null ? `${tier.vcpu} vCPU` : null,
                tier.ram_gb != null ? `${tier.ram_gb} GB RAM` : null,
                tier.storage_gb != null ? `${tier.storage_gb} GB${tier.storage_type ? ` ${tier.storage_type}` : ""}` : null,
                cityLine,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={tier.id}>
                  <span className="rank">{i + 1}</span>
                  <div className="arena-main">
                    <div className="name">{tier.tier_name}</div>
                    <div className="meta">{specs}</div>
                    <div className="meta">
                      {techLink(tier.hypervisor, t.hvUnknown)}
                      {displayTechField(tier.orchestration) ? <> · {techLink(tier.orchestration, "")}</> : null}
                    </div>
                    <div className="meta">
                      {tier.price_native ? `${tier.price_native}` : ""}
                      {tier.currency && !String(tier.price_native || "").includes(tier.currency) ? ` · ${tier.currency}` : ""}
                    </div>
                  </div>
                  <div className="arena-score">
                    <span className="score-label">{t.from} USD/bln</span>
                    <span className="score">${Number(tier.price_usd_month).toFixed(2)}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="cta-row start-actions">
          <a className="btn-cta" href="/arena">
            <span className="btn-ico">
              <Icon name="compare" size={18} />
            </span>
            {t.provBack}
          </a>
        </div>
      </section>
    </>
  );
}
