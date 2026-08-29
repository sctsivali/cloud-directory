"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "./Language";
import type { MapLink, MapSite } from "@/lib/db";

type Mode = "pop" | "sov";

const COUNTRY_ALIAS: Record<string, string> = {
  indonesia: "Indonesia",
  vietnam: "Vietnam",
  malaysia: "Malaysia",
  thailand: "Thailand",
  singapore: "Singapore",
  philippines: "Philippines",
  ph: "Philippines",
  my: "Malaysia",
  id: "Indonesia",
  vn: "Vietnam",
  sg: "Singapore",
  th: "Thailand",
};

function normCountry(raw: string) {
  const s = raw.trim();
  const hit = COUNTRY_ALIAS[s.toLowerCase()];
  if (hit) return hit;
  if (/indonesia/i.test(s)) return "Indonesia";
  if (/vietnam/i.test(s)) return "Vietnam";
  if (/malaysia/i.test(s)) return "Malaysia";
  if (/thailand/i.test(s)) return "Thailand";
  if (/singapore/i.test(s)) return "Singapore";
  if (/philipp/i.test(s)) return "Philippines";
  return s;
}

function normCity(raw: string) {
  const s = raw.trim();
  if (/jakarta|cibitung|bekasi/i.test(s)) return "Jakarta";
  if (/ho chi minh|hcmc|saigon/i.test(s)) return "Ho Chi Minh City";
  if (/kuala lumpur|cyberjaya/i.test(s)) return "Kuala Lumpur";
  if (/yogyakarta|jogja/i.test(s)) return "Yogyakarta";
  return s.split("(")[0].trim();
}

function teal(t: number) {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.round(232 - x * 180);
  const g = Math.round(246 - x * 90);
  const b = Math.round(239 - x * 140);
  return `rgb(${r},${g},${b})`;
}

export function MapView({ links, sites = [], hero = false }: { links: MapLink[]; sites?: MapSite[]; hero?: boolean }) {
  const { t } = useLang();
  const [mode, setMode] = useState<Mode>("sov");
  const [country, setCountry] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [showCables, setShowCables] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const cableRef = useRef<any>(null);

  const rows = useMemo(
    () =>
      links.map((l) => ({
        ...l,
        country: normCountry(l.country),
        city: normCity(l.city),
      })),
    [links]
  );

  const byCountry = useMemo(() => {
    const m = new Map<string, { n: number; local: number; sov: number; sovN: number }>();
    for (const r of rows) {
      const cur = m.get(r.country) || { n: 0, local: 0, sov: 0, sovN: 0 };
      cur.n += 1;
      if (r.is_local_asean) {
        cur.local += 1;
        cur.sov += r.sov_score;
        cur.sovN += 1;
      }
      m.set(r.country, cur);
    }
    const out: Record<string, { providers: number; avgSov: number }> = {};
    for (const [k, v] of m) {
      out[k] = { providers: new Set(rows.filter((r) => r.country === k).map((r) => r.provider_id)).size, avgSov: v.sovN ? v.sov / v.sovN : 0 };
    }
    return out;
  }, [rows]);

  const maxN = Math.max(1, ...Object.values(byCountry).map((x) => x.providers));

  const cities = useMemo(() => {
    if (!country) return [];
    const m = new Map<string, number>();
    for (const r of rows.filter((x) => x.country === country)) {
      m.set(r.city, (m.get(r.city) || 0) + 1);
    }
    return [...m.entries()]
      .map(([name, n]) => ({ name, n: new Set(rows.filter((r) => r.country === country && r.city === name).map((r) => r.provider_id)).size }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 12);
  }, [rows, country]);

  const site = siteKey ? sites.find((s) => String(s.id) === siteKey) || null : null;

  const providers = useMemo(() => {
    if (!country && !siteKey) return [];
    const seen = new Map<string, { id: string; name: string; local: boolean; sov: number; hq: string | null }>();
    for (const r of rows) {
      if (siteKey) {
        const chosen = sites.find((s) => String(s.id) === siteKey);
        if (!chosen || !chosen.provider_ids.includes(r.provider_id)) continue;
      } else {
        if (r.country !== country) continue;
        if (city && r.city !== city) continue;
      }
      if (!seen.has(r.provider_id)) {
        seen.set(r.provider_id, { id: r.provider_id, name: r.name, local: r.is_local_asean, sov: r.sov_score, hq: r.hq_country });
      }
    }
    return [...seen.values()].sort((a, b) => b.sov - a.sov || a.name.localeCompare(b.name));
  }, [rows, country, city, siteKey]);

  useEffect(() => {
    const cssId = "leaflet-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    const start = () => draw();
    if ((window as any).L) start();
    else {
      const s = document.createElement("script");
      s.src = src;
      s.onload = start;
      document.body.appendChild(s);
    }
    window.addEventListener("cia-theme", start);
    return () => window.removeEventListener("cia-theme", start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function colorFor(name: string) {
    const d = byCountry[name];
    const light = document.documentElement.getAttribute("data-theme") === "light";
    if (!d || (mode === "pop" ? d.providers === 0 : d.avgSov === 0)) return light ? "#d4d4d4" : "#4a4a4a";
    if (mode === "pop") return teal(d.providers / maxN);
    return teal(d.avgSov / 100);
  }

  function draw() {
    const L = (window as any).L;
    if (!L || !mapEl.current) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      cableRef.current = null;
    }
    const map = L.map(mapEl.current, { zoomControl: false, attributionControl: false, minZoom: 2, worldCopyJump: true }).setView([4.5, 115], 4);
    const light = document.documentElement.getAttribute("data-theme") === "light";
    const tiles = light
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
    L.tileLayer(tiles, { maxZoom: 11 }).addTo(map);
    mapRef.current = map;
    const stroke = light ? "#8a8a8a" : "#666";
    fetch("/geo/asean.geojson")
      .then((r) => r.json())
      .then((geo) => {
        const layer = L.geoJSON(geo, {
          style: (ft: any) => ({
            color: stroke,
            weight: 1,
            fillColor: colorFor(ft.properties.name),
            fillOpacity: light ? 0.58 : 0.72,
          }),
          onEachFeature: (ft: any, lyr: any) => {
            const name = ft.properties.name as string;
            lyr.on("click", () => {
              setCountry(name);
              setCity(null);
              setSiteKey(null);
            });
            lyr.on("mouseover", () => lyr.setStyle({ weight: 2, color: "#ffde59" }));
            lyr.on("mouseout", () => lyr.setStyle({ weight: 1, color: stroke }));
          },
        }).addTo(map);
        const used = new Map<string, number>();
        for (const s of sites) {
          const bucket = `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`;
          const n = used.get(bucket) || 0;
          used.set(bucket, n + 1);
          const angle = (n * 2.2) % (Math.PI * 2);
          const ring = 0.012 * Math.ceil((n + 1) / 6);
          const lat = s.lat + Math.sin(angle) * ring;
          const lng = s.lng + Math.cos(angle) * ring;
          const pin = L.marker([lat, lng], {
            icon: L.divIcon({
              className: "dc-pin",
              html: `<span class="dc-pin-sonar"></span><span class="dc-pin-sonar delay"></span><span class="dc-pin-dot"></span>`,
              iconSize: [28, 28],
              iconAnchor: [14, 22],
            }),
            zIndexOffset: 400,
          }).addTo(map);
          pin.on("click", (ev: any) => {
            L.DomEvent.stopPropagation(ev);
            setCountry(s.country);
            setCity(s.city);
            setSiteKey(String(s.id));
          });
        }
        map.invalidateSize();
        try {
          map.fitBounds(layer.getBounds(), { padding: [28, 28], maxZoom: 5 });
        } catch {
          map.setView([4.5, 115], 4);
        }
      });
  }

  useEffect(() => {
    const L = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;
    if (!showCables) {
      if (cableRef.current) map.removeLayer(cableRef.current);
      return;
    }
    if (cableRef.current) {
      cableRef.current.addTo(map);
      return;
    }
    fetch("/geo/cables-world.geojson")
      .then((r) => r.json())
      .then((cables) => {
        if (!mapRef.current || !showCables) return;
        const glow = L.geoJSON(cables, {
          style: { color: "#ffde59", weight: 5, opacity: 0.1, className: "cable-glow" },
          interactive: false,
        });
        const core = L.geoJSON(cables, {
          style: { color: "#ffe98a", weight: 0.9, opacity: 0.45, className: "cable-core" },
          interactive: false,
        });
        const pulse = L.geoJSON(cables, {
          style: { color: "#fff8d0", weight: 1.15, opacity: 0.8, className: "cable-pulse" },
          interactive: false,
        });
        cableRef.current = L.layerGroup([glow, core, pulse]).addTo(mapRef.current);
      })
      .catch(() => {
        /* optional */
      });
  }, [showCables]);

  return (
    <>
      {!hero && (
        <>
          <p className="kicker">{t.mapKicker}</p>
          <h1>{t.mapH1}</h1>
          <p className="lede">{t.mapLede}</p>
        </>
      )}
      <div className={hero ? "map-stage map-hero" : "map-stage"}>
        <div ref={mapEl} className="map-canvas" />
        <div className="map-float">
          <div className="scope" role="group">
            <button type="button" className={mode === "pop" ? "active" : ""} onClick={() => setMode("pop")}>
              {t.mapPop}
            </button>
            <button type="button" className={mode === "sov" ? "active" : ""} onClick={() => setMode("sov")}>
              {t.mapSov}
            </button>
          </div>
          <button type="button" className={showCables ? "map-cable-btn active" : "map-cable-btn"} onClick={() => setShowCables((v) => !v)}>
            {t.mapCables}
          </button>
        </div>
        {!country && !site && <p className="map-hint">{t.mapClick}</p>}
        {(country || site) && (
          <div className="map-pop" role="dialog" aria-label={site?.name || country || ""}>
            <div className="map-pop-head">
              <div>
                <h2>{site ? site.name : country}</h2>
                <p className="meta">
                  {site ? `${site.city}, ${site.country} · ${providers.length}` : `${byCountry[country || ""]?.providers ?? 0} · ${t.provSov} ${Math.round(byCountry[country || ""]?.avgSov ?? 0)}`}
                </p>
              </div>
              <button type="button" className="map-close" onClick={() => { setCountry(null); setCity(null); setSiteKey(null); }} aria-label="Close">
                ×
              </button>
            </div>
            {cities.length > 0 && !site && (
              <div className="city-chips">
                {cities.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className={city === c.name ? "active" : ""}
                    onClick={() => setCity(city === c.name ? null : c.name)}
                  >
                    {c.name} ({c.n})
                  </button>
                ))}
              </div>
            )}
            {providers.length === 0 ? (
              <p className="section-sub">{t.mapNone}</p>
            ) : (
              <ol className="list map-scroll">
                {providers.map((p, i) => (
                  <li key={p.id}>
                    <span className="rank">{i + 1}</span>
                    <span>
                      <div className="name">
                        <a href={`/provider/${p.id}`}>{p.name}</a>{" "}
                        <span className="pill">{p.hq || "—"}</span>
                      </div>
                    </span>
                    <span className="score">{p.sov}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </>
  );
}
