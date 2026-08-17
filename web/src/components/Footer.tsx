"use client";

import { Icon } from "./Icon";
import { useLang } from "./Language";

const GH = "https://github.com/sctsivali/arena-cloudinasia";

export function Footer() {
  const { t } = useLang();
  return (
    <footer className="site-foot">
      <div className="page foot-grid">
        <div>
          <p className="kicker">{t.brand}</p>
          <p className="foot-blurb">{t.footBlurb}</p>
        </div>
        <nav aria-label={t.footExplore}>
          <p className="foot-label">{t.footExplore}</p>
          <a href="/start">{t.navStart}</a>
          <a href="/arena">{t.navCompare}</a>
          <a href="/buildings">{t.navBuildings}</a>
          <a href="/tech">{t.navTech}</a>
        </nav>
        <nav aria-label={t.footAbout}>
          <p className="foot-label">{t.footAbout}</p>
          <a href="/methodology">{t.navMethod}</a>
          <a href="/about">{t.navAbout}</a>
          <a href="/correct">{t.navCorrect}</a>
          <a href="https://cloudinasia.com" rel="noopener noreferrer">
            CloudinAsia
          </a>
        </nav>
        <div>
          <p className="foot-label">{t.footSource}</p>
          <a className="foot-gh" href={GH} rel="noopener noreferrer">
            <Icon name="github" size={16} />
            {t.footGithub}
          </a>
          <p className="meta">{t.footLicense}</p>
        </div>
      </div>
      <div className="page foot-bar">
        <span>{t.lastUpdated}</span>
        <span>{t.scoreDisclaimer}</span>
      </div>
    </footer>
  );
}
