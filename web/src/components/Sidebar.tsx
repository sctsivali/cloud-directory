"use client";

import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { Icon } from "./Icon";
import { useLang } from "./Language";

export function Sidebar() {
  const { t } = useLang();
  const path = usePathname();
  const onHome = path === "/";
  const onArena = path.startsWith("/arena");
  const onMeth = path.startsWith("/methodology");
  const learn = [
    { href: "/", label: t.navOverview, icon: "home" as const, active: onHome },
    { href: "/#alur", label: t.navFlow, icon: "book" as const, active: false },
    { href: "/#patuh", label: t.navLaw, icon: "landmark" as const, active: false },
    { href: "/#oss", label: t.navOss, icon: "code" as const, active: false },
    { href: "/methodology", label: t.navMethod, icon: "file" as const, active: onMeth },
  ];
  const decide = [
    { href: "/map", label: t.navMap, icon: "map" as const, active: path.startsWith("/map") },
    { href: "/arena", label: t.navCompare, icon: "scale" as const, active: onArena },
    { href: "/#data", label: t.navData, icon: "server" as const, active: false },
  ];
  return (
    <aside className="sidebar">
      <a className="brand" href="/">
        <img src="/cia-logo.png" alt="Cloud in Asia" className="brand-logo brand-logo-dark" />
        <img src="/cia-logo-light.png" alt="Cloud in Asia" className="brand-logo brand-logo-light" />
      </a>
      <LanguageToggle />
      <nav className="nav">
        <div className="nav-label">{t.navLearn}</div>
        {learn.map((item) => (
          <a key={item.href} href={item.href} className={item.active ? "nav-item active" : "nav-item"}>
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </a>
        ))}
        <div className="nav-label">{t.navPath}</div>
        {decide.map((item) => (
          <a key={item.href} href={item.href} className={item.active ? "nav-item active" : "nav-item"}>
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      <div className="nav-label">{t.navLook}</div>
      <ThemeToggle />
      <div className="side-foot">{t.foot}</div>
    </aside>
  );
}
