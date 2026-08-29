"use client";

import { useLang } from "./Language";
import type { BuildingDetail } from "@/lib/db";

export function BuildingView({ data }: { data: BuildingDetail }) {
  const { t } = useLang();
  return (
    <>
      <p className="kicker">
        <a href="/buildings">{t.bldgBack}</a>
      </p>
      <h1>{data.listed ? data.name : t.bldgUnknownH1}</h1>
      <p className="lede">
        {data.listed
          ? `${data.city}, ${data.country}`
          : t.bldgUnknownSub}
      </p>
      {!data.listed ? <p className="section-sub">{t.bldgUnknownBody}</p> : null}
      {data.photo_path ? (
        <>
          <figure className="bldg-hero">
            <img src={data.photo_path} alt={data.name} />
          </figure>
          <p className="bldg-photo-credit">
            {data.photo_credit}
            {data.photo_source ? (
              <>
                {" · "}
                <a href={data.photo_source} rel="noopener noreferrer">
                  {t.bldgPhotoSrc}
                </a>
              </>
            ) : null}
          </p>
        </>
      ) : data.listed ? (
        <p className="section-sub">{t.bldgNoPhoto}</p>
      ) : null}
      <div className="facts">
        <div className="fact">
          <strong>{data.provider_count}</strong>
          <span>{t.bldgProviders}</span>
        </div>
        <div className="fact">
          <strong>{data.operator || t.hvUnknown}</strong>
          <span>{t.bldgOperator}</span>
        </div>
        <div className="fact">
          <strong>{data.operator_country || t.hvUnknown}</strong>
          <span>{t.bldgOpCountry}</span>
        </div>
        <div className="fact">
          <strong>{data.dc_tier || t.hvUnknown}</strong>
          <span>{t.bldgTier}</span>
        </div>
        <div className="fact">
          <strong>{data.telcos || t.hvUnknown}</strong>
          <span>{t.bldgTelco}</span>
        </div>
        <div className="fact">
          <strong>{data.dc_tech || t.hvUnknown}</strong>
          <span>{t.bldgTech}</span>
        </div>
      </div>
      <p className="section-sub">
        {t.bldgAddress}: {data.address || "—"}
      </p>

      <section className="section">
        <h2>{t.bldgInHere}</h2>
        {data.providers.length === 0 ? (
          <p className="section-sub">—</p>
        ) : (
          <ol className="list arena-list">
            {data.providers.map((p, i) => (
              <li key={p.id}>
                <span className="rank">{i + 1}</span>
                <div className="arena-main">
                  <div className="name">
                    <a href={`/provider/${p.id}`}>{p.name}</a>{" "}
                    {p.hq_country ? <span className="pill">{p.hq_country}</span> : null}
                  </div>
                  <div className="meta">{p.hq_country || "—"}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
