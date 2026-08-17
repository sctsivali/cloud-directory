"use client";

import { Icon } from "./Icon";

export function ThemeToggle() {
  function setTheme(theme: "light" | "dark") {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("cia-theme", theme);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("cia-theme"));
    document.querySelectorAll("[data-theme-btn]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-theme-btn") === theme);
    });
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Tema">
      <button type="button" data-theme-btn="light" onClick={() => setTheme("light")}>
        <Icon name="sun" size={14} />
        <span>Light</span>
      </button>
      <button type="button" data-theme-btn="dark" className="active" onClick={() => setTheme("dark")}>
        <Icon name="moon" size={14} />
        <span>Dark</span>
      </button>
    </div>
  );
}
