"use client";

import { useEffect, useRef } from "react";

type Name = "learn" | "compare" | "decide" | "shield" | "eye" | "unlock" | "sliders" | "code" | "wallet" | "file";

export function LottieWell({ name }: { name: Name }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let anim: { destroy: () => void } | null = null;
    let cancelled = false;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    function play(Lottie: any) {
      if (cancelled || !ref.current) return;
      ref.current.innerHTML = "";
      anim = Lottie.loadAnimation({
        container: ref.current,
        renderer: "svg",
        loop: !reduce,
        autoplay: !reduce,
        path: `/lottie/${name}.json`,
      });
    }

    const w = window as any;
    if (w.lottie) play(w.lottie);
    else {
      const existing = document.querySelector("script[data-lottie]");
      if (existing) {
        existing.addEventListener("load", () => play(w.lottie), { once: true });
      } else {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/lottie-web@5.12.2/build/player/lottie.min.js";
        s.async = true;
        s.dataset.lottie = "1";
        s.onload = () => play(w.lottie);
        document.body.appendChild(s);
      }
    }
    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, [name]);

  return <div className="icon-well lottie-well" ref={ref} aria-hidden />;
}
