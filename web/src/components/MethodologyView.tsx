"use client";

import { Icon, IconWell } from "./Icon";
import { useLang } from "./Language";

export function MethodologyView() {
  const { t } = useLang();
  return (
    <>
      <p className="kicker">{t.methKicker}</p>
      <h1>{t.methH1}</h1>
        <p className="lede">{t.methLede}</p>
        <p className="section-sub">{t.lastUpdated}</p>

      <section className="section">
        <h2>{t.methVerT}</h2>
        <p className="section-sub">{t.methVer}</p>
        <p className="section-sub">{t.methConfBody}</p>
      </section>

      <section className="section">
        <div className="flag-row">
          <IconWell name="shield" />
        </div>
        <h2>{t.methSovT}</h2>
        <ol className="rule-list">
          <li>{t.methSov1}</li>
          <li>{t.methSov2}</li>
          <li>{t.methSov3}</li>
          <li>{t.methSov4}</li>
        </ol>
        <p className="section-sub">{t.methSovNote}</p>
      </section>

      <section className="section">
        <IconWell name="code" />
        <h2>{t.methOssT}</h2>
        <ol className="rule-list">
          <li>{t.methOss1}</li>
          <li>{t.methOss2}</li>
          <li>{t.methOss3}</li>
          <li>{t.methOss4}</li>
          <li>{t.methOss5}</li>
        </ol>
        <p className="section-sub">{t.methOssNote}</p>
      </section>

      <section className="section">
        <IconWell name="wallet" />
        <h2>{t.methOtherT}</h2>
        <p className="section-sub">{t.methOther}</p>
      </section>

      <section className="section">
        <IconWell name="file" />
        <h2>{t.methLimitT}</h2>
        <p className="section-sub">{t.methLimit}</p>
      </section>

      <section className="section">
        <IconWell name="shield" />
        <h2>{t.methLawT}</h2>
        <p className="section-sub">{t.methLaw}</p>
        <p>
          <a className="go" href="/arena">
            {t.methGo} <Icon name="arrow" size={16} />
          </a>
        </p>
      </section>
    </>
  );
}
