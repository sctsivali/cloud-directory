"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { COPY, type Copy, type Lang } from "@/lib/copy";

type Ctx = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Copy;
};

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("id");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cia-lang");
      if (saved === "id" || saved === "en") setLangState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function setLang(next: Lang) {
    setLangState(next);
    document.documentElement.lang = next === "en" ? "en" : "id";
    try {
      localStorage.setItem("cia-lang", next);
    } catch {
      /* ignore */
    }
  }

  const value = useMemo(() => ({ lang, setLang, t: COPY[lang] }), [lang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang");
  return ctx;
}
