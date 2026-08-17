"use client";

import { useLang } from "./Language";
import { Flag } from "./Flag";
import { TECH, kindLabel, officialTechLogo, stackBlob, techMono, techOrigin, techsForBlob } from "@/lib/tech";
import type { TechProvider } from "@/lib/db";

export function TechListView({ stacks }: { stacks: TechProvider[] }) {
  const { lang, t } = useLang();
  const counts = Object.fromEntries(
    TECH.map((tech) => [
      tech.slug,
      stacks.filter((s) => techsForBlob(stackBlob(s)).some((x) => x.slug === tech.slug)).length,
    ])
  );
  const kinds = ["hypervisor", "platform", "container", "orchestrator", "storage", "control"] as const;
  return (
    <>
      <p className="kicker">{t.techKicker}</p>
      <h1>{t.techH1}</h1>
      <p className="lede">{t.techLede}</p>
      <p className="section-sub">{t.techCountNote}</p>
      {kinds.map((kind) => {
        const items = TECH.filter((x) => x.kind === kind);
        if (!items.length) return null;
        return (
          <section className="section" key={kind}>
            <h2>{kindLabel(kind, lang)}</h2>
            <ol className="list arena-list media-list">
              {items.map((tech) => {
                const logo = officialTechLogo(tech.slug);
                const origin = techOrigin(tech.slug);
                const ent =
                  origin?.enterprise === "yes" ? t.techEntYes : origin?.enterprise === "no" ? t.techEntNo : origin ? t.techEntIndirect : "";
                return (
                  <li key={tech.slug}>
                    <span className="tech-logo-well">
                      {logo ? (
                        <img src={logo} alt="" width={28} height={28} />
                      ) : (
                        <span className="tech-mono">{techMono(tech.name)}</span>
                      )}
                    </span>
                    <div className="arena-main">
                      <div className="name">
                        <a href={`/tech/${tech.slug}`}>{tech.name}</a>{" "}
                        {tech.licence === "varies" ? (
                          <span className="pill">{t.techVaried}</span>
                        ) : tech.open ? (
                          <span className="pill">{t.techOpen}</span>
                        ) : (
                          <span className="pill">{t.techClosed}</span>
                        )}
                      </div>
                      <div className="meta">{lang === "en" ? tech.en.lead : tech.id.lead}</div>
                      {origin ? (
                        <div className="meta flag-row">
                          {origin.flags.map((code) => (
                            <Flag key={code} code={code} title={origin.country} />
                          ))}
                          {t.techOrigin}: {origin.country} · {t.techSteward}: {origin.steward} · {t.techEnterprise}: {ent}
                        </div>
                      ) : null}
                    </div>
                    <div className="arena-score">
                      <span className="score-label">{t.techProviders}</span>
                      <span className="score">{counts[tech.slug] ?? 0}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </>
  );
}
