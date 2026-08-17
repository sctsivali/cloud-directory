"use client";

import { useLang } from "./Language";

export function LanguageToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button type="button" className={lang === "id" ? "active" : ""} onClick={() => setLang("id")}>
        ID
      </button>
      <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
        EN
      </button>
    </div>
  );
}
