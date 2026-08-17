"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { useLang } from "./Language";

export function Header() {
  const { t } = useLang();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/", label: t.navOverview, active: path === "/" },
    { href: "/start", label: t.navStart, active: path.startsWith("/start") },
    { href: "/arena", label: t.navCompare, active: path.startsWith("/arena") },
    { href: "/buildings", label: t.navBuildings, active: path.startsWith("/building") },
    { href: "/tech", label: t.navTech, active: path.startsWith("/tech") },
    { href: "/about", label: t.navAbout, active: path.startsWith("/about") },
    { href: "/methodology", label: t.navMethod, active: path.startsWith("/methodology") },
    { href: "/#patuh", label: t.navLaw, active: false },
  ];
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="/" onClick={() => setOpen(false)}>
          <img src="/cia-logo.png" alt="Cloud in Asia" className="brand-logo brand-logo-dark" />
          <img src="/cia-logo-light.png" alt="Cloud in Asia" className="brand-logo brand-logo-light" />
        </a>
        <nav className="topnav" aria-label="Primary">
          {links.map((item) => (
            <a key={item.href} href={item.href} className={item.active ? "top-link active" : "top-link"}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="top-tools">
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
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile">
          {links.map((item) => (
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
