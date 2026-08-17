"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "./Language";
import { Icon } from "./Icon";
import { Flag, flagForCountry } from "./Flag";
import type { ArenaRow } from "@/lib/db";
import { loadCompare, saveCompare } from "@/lib/needs";
import { officialTechLogo, stackBlob, techMono, techsForBlob } from "@/lib/tech";

type Tab = "sov" | "oss" | "cost" | "cover" | "perf" | "conf";
type Scope = "asean" | "all";

export function ArenaView({ rows }: { rows: ArenaRow[] }) {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("sov");
  const [scope, setScope] = useState<Scope>("asean");
  const [country, setCountry] = useState("all");
  const [compare, setCompare] = useState<string[]>([]);
  const [fromNeed, setFromNeed] = useState(false);

  useEffect(() => {
    setCompare(loadCompare());
    const q = new URLSearchParams(window.location.search);
    if (q.get("need") === "1") setFromNeed(true);
    const sort = q.get("sort") as Tab | null;
    if (sort && ["sov", "oss", "cost", "cover", "perf", "conf"].includes(sort)) setTab(sort);
    const sc = q.get("scope");
    if (sc === "all" || sc === "asean") setScope(sc);
    const hq = q.get("hq");
    if (hq) setCountry(hq);
  }, []);

  function toggleCompare(id: string) {
    setCompare((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id];
      saveCompare(next);
      return next;
    });
  }
  const asean = ["Indonesia", "Vietnam", "Malaysia", "Singapore", "Thailand", "Philippines"];
  const countries = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.hq_country) set.add(r.hq_country);
    });
    const all = [...set].sort();
    return scope === "asean" ? asean.filter((c) => set.has(c)) : all;
  }, [rows, scope]);

  const ranked = useMemo(() => {
    let base = scope === "asean" ? rows.filter((r) => r.is_local_asean) : rows;
    if (country !== "all") base = base.filter((r) => (r.hq_country || "") === country);
    const copy = [...base];
    copy.sort((a, b) => {
      if (tab === "sov") return b.sov_score - a.sov_score;
      if (tab === "oss") return b.oss_score - a.oss_score;
      if (tab === "conf") return b.conf_score - a.conf_score;
      if (tab === "cost") return (a.min_price ?? 9e9) - (b.min_price ?? 9e9);
      if (tab === "cover") return b.loc_count - a.loc_count;
      return (b.max_vcpu ?? 0) - (a.max_vcpu ?? 0) || (b.max_ram ?? 0) - (a.max_ram ?? 0);
    });
    return copy;
  }, [rows, tab, scope, country]);

  function metric(r: ArenaRow) {
    if (tab === "cost") return r.min_price != null ? `${t.from} $${r.min_price.toFixed(2)}` : "—";
    if (tab === "cover") return `${r.loc_count} DC`;
    if (tab === "perf") return `${r.max_vcpu ?? "—"} vCPU · ${r.max_ram ?? "—"} GB`;
    if (tab === "oss") return r.hypervisor || t.hvUnknown;
    return r.data_residency || r.origin || "—";
  }

  function scoreCaption() {
    if (tab === "sov") return t.scoreSov;
    if (tab === "oss") return t.scoreOss;
    if (tab === "conf") return t.scoreConf;
    if (tab === "cost") return t.scoreCost;
    if (tab === "cover") return t.scoreCover;
    return t.scorePerf;
  }

  function score(r: ArenaRow) {
    if (tab === "sov") return r.sov_score;
    if (tab === "oss") return r.oss_score;
    if (tab === "conf") return r.conf_score;
    if (tab === "cost") return r.min_price != null ? r.min_price.toFixed(0) : "—";
    if (tab === "cover") return r.loc_count;
    return r.max_vcpu ?? "—";
  }

  function techsOf(r: ArenaRow) {
    return techsForBlob(
      stackBlob({
        hypervisor: r.hypervisor,
        orchestration: r.orchestration,
        storage: r.storage,
        container_runtime: r.container_runtime,
        control_plane: r.control_plane,
      })
    ).slice(0, 5);
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "sov", label: t.tabSov },
    { id: "oss", label: t.tabOss },
    { id: "conf", label: t.scoreConf },
    { id: "cost", label: t.tabCost },
    { id: "cover", label: t.tabCover },
    { id: "perf", label: t.tabPerf },
  ];

  return (
    <>
      <p className="kicker">{t.arenaKicker}</p>
      <h1>{t.arenaH1}</h1>
      <p className="lede">
        {t.arenaLede}{" "}
        <a href="/methodology">{t.navMethod}</a>.
      </p>
      <p className="section-sub">{t.scoreDisclaimer}</p>
      {fromNeed ? <p className="section-sub">{t.screenBanner}</p> : null}

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              className={tab === x.id ? "active" : ""}
              onClick={() => setTab(x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="scope" role="group">
          <button type="button" className={scope === "asean" ? "active" : ""} onClick={() => setScope("asean")}>
            {t.scopeAsean}
          </button>
          <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>
            {t.scopeAll}
          </button>
        </div>
      </div>
      <div className="city-chips" role="group" aria-label={t.filterCountry}>
        <button type="button" className={country === "all" ? "active" : ""} onClick={() => setCountry("all")}>
          {t.filterAll}
        </button>
        {countries.map((c) => (
          <button key={c} type="button" className={country === c ? "active" : ""} onClick={() => setCountry(c)}>
            {c}
          </button>
        ))}
      </div>
      <p className="meta">
        {ranked.length} {t.nShown}
      </p>

      {ranked.length === 0 ? (
        <p className="section-sub">{t.empty}</p>
      ) : (
        <ol className="arena-cards">
          {ranked.map((r, i) => {
            const hqFlag = flagForCountry(r.hq_country);
            const techs = techsOf(r);
            return (
              <li key={r.id} className="arena-card">
                <span className="rank">{i + 1}</span>
                <div className="arena-main">
                  <div className="name">
                    <a href={`/provider/${r.id}`}>{r.name}</a>
                    {hqFlag ? <Flag code={hqFlag} title={r.hq_country || ""} /> : null}
                    <span className="pill">{r.hq_country || "—"}</span>
                  </div>
                  <div className="status-row">
                    {r.is_local_asean ? (
                      <span className="status-chip local" title={t.chipLocal}>
                        <Icon name="landmark" size={14} />
                        {t.chipLocal}
                      </span>
                    ) : (
                      <span className="status-chip" title={t.chipGlobal}>
                        <Icon name="globe" size={14} />
                        {t.chipGlobal}
                      </span>
                    )}
                    {r.conf_score >= 50 ? (
                      <span className="status-chip" title={t.scoreConf}>
                        <Icon name="file" size={14} />
                        {t.scoreConf} {r.conf_score}
                      </span>
                    ) : (
                      <span className="status-chip warn" title={t.chipAsk}>
                        <Icon name="help" size={14} />
                        {t.chipAsk}
                      </span>
                    )}
                    {r.hypervisor ? (
                      <span className="status-chip">
                        <Icon name="server" size={14} />
                        {r.hypervisor}
                      </span>
                    ) : (
                      <span className="status-chip warn">
                        <Icon name="help" size={14} />
                        {t.hvUnknown}
                      </span>
                    )}
                    {r.legal_country === "United States" ? (
                      <span className="status-chip warn">
                        <Icon name="globe" size={14} />
                        {t.riskUs}
                      </span>
                    ) : null}
                    {r.legal_country === "China" ? (
                      <span className="status-chip warn">
                        <Icon name="globe" size={14} />
                        {t.riskCn}
                      </span>
                    ) : null}
                  </div>
                  {techs.length > 0 ? (
                    <div className="arena-techs">
                      {techs.map((tech) => {
                        const logo = officialTechLogo(tech.slug);
                        return (
                          <a key={tech.slug} className="tech-logo-well" href={`/tech/${tech.slug}`} title={tech.name}>
                            {logo ? <img src={logo} alt={tech.name} width={18} height={18} /> : <span className="tech-mono">{techMono(tech.name)}</span>}
                          </a>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="arena-metric">{metric(r)}</div>
                </div>
                <div className="arena-side">
                  <div className="arena-score">
                    <span className="score-label">{scoreCaption()}</span>
                    <span className="score">{score(r)}</span>
                  </div>
                  <button
                    type="button"
                    className={compare.includes(r.id) ? "row-cmp on" : "row-cmp"}
                    onClick={() => toggleCompare(r.id)}
                    aria-pressed={compare.includes(r.id)}
                    aria-label={compare.includes(r.id) ? t.inCompare : t.addCompare}
                  >
                    <Icon name={compare.includes(r.id) ? "check" : "plus"} size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {compare.length > 0 ? (
        compare.length >= 2 ? (
          <a className="compare-fab" href="/compare" aria-label={`${t.compareNav} ${compare.length}`}>
            <Icon name="compare" size={22} />
            <span className="compare-fab-count">{compare.length}</span>
          </a>
        ) : (
          <span className="compare-fab wait" aria-label={`${t.compareNav} ${compare.length}`}>
            <Icon name="compare" size={22} />
            <span className="compare-fab-count">{compare.length}</span>
          </span>
        )
      ) : null}
    </>
  );
}
