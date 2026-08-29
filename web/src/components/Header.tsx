"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { useLang } from "./Language";
import { Icon } from "./Icon";

type LinkItem = { href: string; label: string; active: boolean };

export function Header() {
  const { t } = useLang();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const primary: LinkItem[] = [
    { href: "/", label: t.navOverview, active: path === "/" },
    { href: "/start", label: t.navStart, active: path.startsWith("/start") },
    { href: "/arena", label: t.navCompare, active: path.startsWith("/arena") },
    { href: "/buildings", label: t.navBuildings, active: path.startsWith("/building") },
    { href: "/tech", label: t.navTech, active: path.startsWith("/tech") },
  ];
  const more: LinkItem[] = [
    { href: "/updates", label: t.navUpdates, active: path.startsWith("/updates") },
    { href: "/methodology", label: t.navMethod, active: path.startsWith("/methodology") },
    { href: "/about", label: t.navAbout, active: path.startsWith("/about") },
    { href: "/#patuh", label: t.navLaw, active: false },
  ];
  const moreActive = more.some((item) => item.active);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="/" onClick={() => setOpen(false)}>
          <img src="/cia-logo.png" alt="Cloud in Asia" className="brand-logo brand-logo-dark" />
          <img src="/cia-logo-light.png" alt="Cloud in Asia" className="brand-logo brand-logo-light" />
        </a>
        <nav className="topnav" aria-label="Primary">
          {primary.map((item) => (
            <a key={item.href} href={item.href} className={item.active ? "top-link active" : "top-link"}>
              {item.label}
            </a>
          ))}
          <div className="nav-more" ref={moreRef}>
            <button
              type="button"
              className={moreOpen || moreActive ? "top-link nav-more-btn active" : "top-link nav-more-btn"}
              aria-expanded={moreOpen}
              aria-controls="nav-more-panel"
              onClick={() => setMoreOpen((v) => !v)}
            >
              {t.navMore}
              <span className="nav-caret" aria-hidden="true" />
            </button>
            {moreOpen && (
              <div id="nav-more-panel" className="nav-more-panel" role="menu">
                {more.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    className={item.active ? "top-link active" : "top-link"}
                    onClick={() => setMoreOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </nav>
        <div className="top-tools">
          <a className="top-home" href="https://cloudinasia.com" aria-label={t.navMainSiteAria}>
            <Icon name="external" size={16} />
            <span>{t.navMainSite}</span>
          </a>
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <button
          type="button"
          className="menu-btn"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t.navClose : t.navMenu}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile">
          <a className="top-link" href="https://cloudinasia.com" aria-label={t.navMainSiteAria} onClick={() => setOpen(false)}>
            {t.navMainSite}
          </a>
          {primary.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={item.active ? "top-link active" : "top-link"}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <p className="nav-label mobile-more-label">{t.navMore}</p>
          {more.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={item.active ? "top-link active" : "top-link"}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <div className="mobile-tools">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </nav>
      )}
    </header>
  );
}
