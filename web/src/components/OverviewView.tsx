"use client";

import { useMemo, useState } from "react";
import { Icon, IconWell } from "./Icon";
import { Flag } from "./Flag";
import { MapView } from "./MapView";
import { useLang } from "./Language";
import type { MapLink, MapSite, OverviewData } from "@/lib/db";

export function OverviewView({ data, links, sites }: { data: OverviewData; links: MapLink[]; sites: MapSite[] }) {
  const { t } = useLang();
  const [country, setCountry] = useState("all");
  const asean = ["Indonesia", "Vietnam", "Malaysia", "Singapore", "Thailand", "Philippines"];
  const localList = useMemo(() => {
    const rows = data.topLocal.filter((p) => (country === "all" ? true : (p.hq_country || "") === country));
    return rows;
  }, [data.topLocal, country]);
  return (
    <>
      <p className="kicker">{t.kicker}</p>
      <h1>
        {t.h1a} <span className="grad">{t.h1b}</span>
      </h1>
      <p className="lede">{t.lede}</p>
      <p className="section-sub">{t.trustNote}</p>
      <div className="cta-row">
        <a className="btn-cta" href="/start">
          <span className="btn-ico">
            <Icon name="compass" size={18} />
          </span>
          {t.heroCta}
        </a>
        <a className="btn-cta ghost" href="/arena">
          <span className="btn-ico">
            <Icon name="compare" size={18} />
          </span>
          {t.heroCta2}
        </a>
      </div>
      <div className="hero-bleed">
        <MapView links={links} sites={sites} hero />
      </div>
      <div className="facts">
        <div className="fact">
          <strong>{data.localCount}</strong>
          <span>{t.factLocal}</span>
        </div>
        <div className="fact">
          <strong>{data.providerCount}</strong>
          <span>{t.factAll}</span>
        </div>
        <div className="fact">
          <strong>{data.tierCount}</strong>
          <span>{t.factTiers}</span>
        </div>
        <div className="fact">
          <strong>{data.ossCount}</strong>
          <span>{t.factOss}</span>
        </div>
        <div className="fact">
          <strong>{data.buildingCount}</strong>
          <span>
            <a className="btn-cta ghost" href="/buildings">
              <span className="btn-ico">
                <Icon name="building" size={16} />
              </span>
              {t.factBuildings}
            </a>
          </span>
        </div>
      </div>

      <section className="section" id="alur">
        <p className="kicker">{t.flowKicker}</p>
        <h2>{t.flowH2}</h2>
        <p className="section-sub">{t.flowSub}</p>
        <div className="grid-3">
          <article className="card">
            <IconWell name="book" />
            <div className="num">01</div>
            <h3>{t.flow1t}</h3>
            <p>{t.flow1}</p>
          </article>
          <article className="card">
            <IconWell name="compare" />
            <div className="num">02</div>
            <h3>{t.flow2t}</h3>
            <p>{t.flow2}</p>
          </article>
          <article className="card">
            <IconWell name="check" />
            <div className="num">03</div>
            <h3>{t.flow3t}</h3>
            <p>{t.flow3}</p>
            <a className="btn-cta ghost" href="/start">
              <span className="btn-ico">
                <Icon name="compass" size={16} />
              </span>
              {t.heroCta}
            </a>
          </article>
        </div>
      </section>

      <section className="section" id="konsep">
        <p className="kicker">{t.conceptKicker}</p>
        <h2>{t.conceptH2}</h2>
        <div className="grid-3">
          {[
            ["map", t.concept1t, t.concept1],
            ["landmark", t.concept2t, t.concept2],
            ["key", t.concept3t, t.concept3],
            ["refresh", t.concept4t, t.concept4],
            ["file", t.concept5t, t.concept5],
          ].map(([icon, title, body]) => (
            <article className="card" key={title}>
              <IconWell name={icon as "map"} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
        <div className="cta-row">
          <a className="btn-cta" href="/start">
            <span className="btn-ico">
              <Icon name="list" size={18} />
            </span>
            {t.heroCta}
          </a>
        </div>
      </section>

      <section className="section" id="patuh">
        <p className="kicker">{t.lawKicker}</p>
        <h2>{t.lawH2}</h2>
        <p className="section-sub">{t.lawSub}</p>
        <p className="section-sub">{t.lawBanner}</p>
        <p className="section-sub">{t.lawOssBadge}</p>
        <article className="card law-lead">
          <div className="flag-row">
            <Flag code="id" title="Indonesia" />
            <div className="num">Indonesia · UU No. 27 / 2022</div>
          </div>
          <h3>{t.lawIdT}</h3>
          <p>{t.lawId1}</p>
          <p>{t.lawId2}</p>
        </article>
        <div className="law-grid">
          <article className="card">
            <div className="flag-row">
              <Flag code="sg" title="Singapore" />
              <div className="num">Singapore</div>
            </div>
            <h3>PDPA 2012</h3>
            <p>{t.lawSg}</p>
          </article>
          <article className="card">
            <div className="flag-row">
              <Flag code="my" title="Malaysia" />
              <div className="num">Malaysia</div>
            </div>
            <h3>PDPA 2010</h3>
            <p>{t.lawMy}</p>
          </article>
          <article className="card">
            <div className="flag-row">
              <Flag code="th" title="Thailand" />
              <div className="num">Thailand</div>
            </div>
            <h3>PDPA 2019</h3>
            <p>{t.lawTh}</p>
          </article>
          <article className="card">
            <div className="flag-row">
              <Flag code="ph" title="Philippines" />
              <div className="num">Philippines</div>
            </div>
            <h3>Data Privacy Act 2012</h3>
            <p>{t.lawPh}</p>
          </article>
          <article className="card">
            <div className="flag-row">
              <Flag code="vn" title="Vietnam" />
              <div className="num">Vietnam</div>
            </div>
            <h3>{t.lawVnT}</h3>
            <p>{t.lawVn}</p>
          </article>
          <article className="card">
            <div className="flag-row">
              <Flag code="asean" title="ASEAN" />
              <div className="num">ASEAN</div>
            </div>
            <h3>{t.lawNone}</h3>
            <p>{t.lawAsean}</p>
          </article>
        </div>
      </section>

      <section className="section" id="oss">
        <p className="kicker">{t.ossKicker}</p>
        <h2>{t.ossH2}</h2>
        <p className="section-sub">{t.ossSub.replace("{n}", String(data.ossCount))}</p>
        <h3>{t.ossPolicyH2}</h3>
        <p className="section-sub">{t.ossPolicySub}</p>
        <div className="grid-3">
          <article className="card">
            <IconWell name="eye" />
            <div className="num">01</div>
            <h3>{t.oss1t}</h3>
            <p>{t.oss1}</p>
          </article>
          <article className="card">
            <IconWell name="unlock" />
            <div className="num">02</div>
            <h3>{t.oss2t}</h3>
            <p>{t.oss2}</p>
          </article>
          <article className="card">
            <IconWell name="sliders" />
            <div className="num">03</div>
            <h3>{t.oss3t}</h3>
            <p>{t.oss3}</p>
          </article>
        </div>
        <div className="cta-row">
          <a className="btn-cta ghost" href="/tech">
            <span className="btn-ico">
              <Icon name="code" size={18} />
            </span>
            {t.path2go}
          </a>
          <a className="btn-cta ghost" href="/methodology">
            <span className="btn-ico">
              <Icon name="scale" size={18} />
            </span>
            {t.navMethod}
          </a>
        </div>
      </section>

      <section className="section" id="pilih">
        <p className="kicker">{t.pathKicker}</p>
        <h2>{t.pathH2}</h2>
        <div className="grid-3">
          <article className="card">
            <IconWell name="shield" />
            <h3>{t.path1t}</h3>
            <p>{t.path1}</p>
            <a className="btn-cta ghost" href="/arena">
              <span className="btn-ico">
                <Icon name="shield" size={16} />
              </span>
              {t.path1go}
            </a>
          </article>
          <article className="card">
            <IconWell name="code" />
            <h3>{t.path2t}</h3>
            <p>{t.path2}</p>
            <a className="btn-cta ghost" href="/tech">
              <span className="btn-ico">
                <Icon name="code" size={16} />
              </span>
              {t.path2go}
            </a>
          </article>
          <article className="card">
            <IconWell name="wallet" />
            <h3>{t.path3t}</h3>
            <p>{t.path3}</p>
            <a className="btn-cta ghost" href="/arena">
              <span className="btn-ico">
                <Icon name="wallet" size={16} />
              </span>
              {t.path3go}
            </a>
          </article>
        </div>
      </section>

      <section className="section" id="data">
        <p className="kicker">{t.dataKicker}</p>
        <h2>{t.dataH2}</h2>
        <p className="section-sub">{t.dataSub}</p>
        <p className="section-sub">{t.scoreDisclaimer}</p>
        <div className="city-chips" role="group" aria-label={t.filterCountry}>
          <button type="button" className={country === "all" ? "active" : ""} onClick={() => setCountry("all")}>
            {t.filterAll}
          </button>
          {asean.map((c) => (
            <button key={c} type="button" className={country === c ? "active" : ""} onClick={() => setCountry(c)}>
              {c}
            </button>
          ))}
        </div>
        <ol className="list arena-list">
          {localList.map((p, i) => (
            <li key={p.id}>
              <span className="rank">{i + 1}</span>
              <div className="arena-main">
                <div className="name">
                  <a href={`/provider/${p.id}`}>{p.name}</a>{" "}
                  <span className="pill">{p.hq_country || "—"}</span>
                </div>
                <div className="meta">
                  {p.hq_country || "—"} · {p.tier_count} {t.pkg} · {p.hypervisor || t.hvUnknown}
                </div>
                <div className="arena-metric">
                  {p.min_price != null ? `${t.from} $${p.min_price.toFixed(2)}` : "—"}
                </div>
              </div>
              <div className="arena-score">
                <span className="score-label">{t.scoreSov}</span>
                <span className="score">{p.sov_score}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section">
        <p className="kicker">
          <span className="icon-inline">
            <Icon name="map" size={16} />
          </span>
          {t.cityKicker}
        </p>
        <h2>{t.cityH2}</h2>
        <p className="section-sub">{t.citySub}</p>
        <div className="city-grid">
          {data.cities.map((c) => (
            <div className="city" key={`${c.city}-${c.country}`}>
              <b>{c.city}</b>
              <span>
                {c.country} · {c.providers} {t.cityProv}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
