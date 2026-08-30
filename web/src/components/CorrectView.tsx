"use client";

import { FormEvent, useEffect, useState } from "react";
import { useLang } from "./Language";
import { Icon } from "./Icon";

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
  const [busy, setBusy] = useState<"rescan" | "claim" | "">("");

  useEffect(() => {
    fetch("/api/correct/rescan")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers || []))
      .catch(() => setProviders([]));
  }, []);

  async function post(kind: "rescan" | "claim", url: string, body: object) {
    setMsg("");
    setErr("");
    setBusy(kind);
    try {
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
    } finally {
      setBusy("");
    }
  }

  function onRescan(e: FormEvent) {
    e.preventDefault();
    void post("rescan", "/api/correct/rescan", {
      provider_id: rescanId,
      email: rescanEmail,
    });
  }
  function onClaim(e: FormEvent) {
    e.preventDefault();
    void post("claim", "/api/correct/claim", {
      provider_id: claimId,
      email: claimEmail,
    });
  }

  return (
    <>
      <p className="kicker">{t.correctKicker}</p>
      <h1>{t.correctH1}</h1>
      <p className="lede">{t.correctLede}</p>

      <div className="correct-note" role="note">
        {t.correctDisclaimer}
      </div>

      {msg ? (
        <p className="correct-flash ok" role="status">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p className="correct-flash bad" role="alert">
          {err}
        </p>
      ) : null}

      <div className="correct-grid">
        <section className="card correct-card">
          <p className="num">01</p>
          <h3>{t.correctRescanH2}</h3>
          <p>{t.correctRescanHelp}</p>
          <form className="correct-form" onSubmit={onRescan}>
            <label className="field">
              <span>{t.correctProvider}</span>
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
            <label className="field">
              <span>{t.correctEmailOpt}</span>
              <input
                type="email"
                value={rescanEmail}
                onChange={(e) => setRescanEmail(e.target.value)}
              />
            </label>
            <button className="btn-cta" type="submit" disabled={busy === "rescan"}>
              <span className="btn-ico">
                <Icon name="refresh" size={16} />
              </span>
              {t.correctRescanBtn}
            </button>
          </form>
        </section>

        <section className="card correct-card">
          <p className="num">02</p>
          <h3>{t.correctClaimH2}</h3>
          <p>{t.correctClaimHelp}</p>
          <ol className="correct-steps">
            <li>{t.correctClaimStep1}</li>
            <li>{t.correctClaimStep2}</li>
            <li>{t.correctClaimStep3}</li>
          </ol>
          <form className="correct-form" onSubmit={onClaim}>
            <label className="field">
              <span>{t.correctProvider}</span>
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
            <label className="field">
              <span>{t.correctClaimEmail}</span>
              <input
                type="email"
                required
                value={claimEmail}
                onChange={(e) => setClaimEmail(e.target.value)}
              />
            </label>
            <button className="btn-cta" type="submit" disabled={busy === "claim"}>
              <span className="btn-ico">
                <Icon name="key" size={16} />
              </span>
              {t.correctClaimBtn}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
