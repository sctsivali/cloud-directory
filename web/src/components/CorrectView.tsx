"use client";

import { useLang } from "./Language";

export function CorrectView() {
  const { t } = useLang();
  return (
    <>
      <p className="kicker">{t.correctKicker}</p>
      <h1>{t.correctH1}</h1>
      <p className="lede">{t.correctLede}</p>
      <p className="section-sub">{t.correctHow}</p>
      <p className="section-sub">{t.lastUpdated}</p>
      <p>
        <a className="go" href="https://cloudinasia.com" rel="noopener noreferrer">
          {t.correctGo}
        </a>
      </p>
    </>
  );
}
