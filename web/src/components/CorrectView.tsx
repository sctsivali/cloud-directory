"use client";

import { FormEvent, useEffect, useState } from "react";
import { useLang } from "./Language";

type Choice = { id: string; name: string };

export function CorrectView() {
  const { t } = useLang();
  const [providers, setProviders] = useState<Choice[]>([]);
  const [rescanId, setRescanId] = useState("");
  const [rescanEmail, setRescanEmail] = useState("");
  const [claimId, setClaimId] = useState("");
  const [claimEmail, setClaimEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/correct/rescan")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers || []))
      .catch(() => setProviders([]));
  }, []);

  async function post(url: string, body: object) {
    setMsg("");
    setErr("");
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(d.error || t.correctFail);
      return;
    }
    setMsg(t.correctOk);
  }

  function onRescan(e: FormEvent) {
    e.preventDefault();
    void post("/api/correct/rescan", { provider_id: rescanId, email: rescanEmail });
  }
  function onClaim(e: FormEvent) {
    e.preventDefault();
    void post("/api/correct/claim", { provider_id: claimId, email: claimEmail });
  }

  return (
    <>
      <p className="kicker">{t.correctKicker}</p>
      <h1>{t.correctH1}</h1>
      <p className="lede">{t.correctLede}</p>
      <p className="section-sub">{t.correctDisclaimer}</p>
      {msg ? <p className="section-sub">{msg}</p> : null}
      {err ? <p className="section-sub">{err}</p> : null}

      <section className="section">
        <h2>{t.correctRescanH2}</h2>
        <p className="section-sub">{t.correctRescanHelp}</p>
        <form onSubmit={onRescan}>
          <p>
            <label>
              {t.correctProvider}
              <br />
              <select
                required
                value={rescanId}
                onChange={(e) => setRescanId(e.target.value)}
              >
                <option value="">{t.correctPick}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              {t.correctEmailOpt}
              <br />
              <input
                type="email"
                value={rescanEmail}
                onChange={(e) => setRescanEmail(e.target.value)}
              />
            </label>
          </p>
          <p>
            <button className="btn-cta" type="submit">
              {t.correctRescanBtn}
            </button>
          </p>
        </form>
      </section>

      <section className="section">
        <h2>{t.correctClaimH2}</h2>
        <p className="section-sub">{t.correctClaimHelp}</p>
        <form onSubmit={onClaim}>
          <p>
            <label>
              {t.correctProvider}
              <br />
              <select
                required
                value={claimId}
                onChange={(e) => setClaimId(e.target.value)}
              >
                <option value="">{t.correctPick}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              {t.correctClaimEmail}
              <br />
              <input
                type="email"
                required
                value={claimEmail}
                onChange={(e) => setClaimEmail(e.target.value)}
              />
            </label>
          </p>
          <p>
            <button className="btn-cta" type="submit">
              {t.correctClaimBtn}
            </button>
          </p>
        </form>
      </section>
    </>
  );
}
