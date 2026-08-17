"use client";

import { useLang } from "./Language";

export function AboutView() {
  const { t } = useLang();
  return (
    <>
      <p className="kicker">{t.aboutKicker}</p>
      <h1>{t.aboutH1}</h1>
      <p className="lede">{t.aboutLede}</p>

      <section className="section">
        <h2>{t.about1t}</h2>
        <p className="section-sub">{t.about1}</p>
      </section>
      <section className="section">
        <h2>{t.about2t}</h2>
        <p className="section-sub">{t.about2}</p>
      </section>
      <section className="section">
        <h2>{t.about3t}</h2>
        <p className="section-sub">{t.about3}</p>
      </section>
      <section className="section">
        <h2>{t.about4t}</h2>
        <p className="section-sub">{t.about4}</p>
      </section>
      <p>
        <a className="go" href="/methodology">
          {t.navMethod}
        </a>
        {" · "}
        <a className="go" href="/correct">
          {t.navCorrect}
        </a>
        {" · "}
        <a className="go" href="/tech">
          {t.navTech}
        </a>
      </p>
    </>
  );
}
