"use client";

import { useLang } from "./Language";
import type { PublicDirectoryUpdate } from "../../../packages/domain/src/revisions/public-feed.ts";

export type UpdateItem = PublicDirectoryUpdate;

function fmtWib(iso: string, lang: "id" | "en") {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date}, ${time} WIB`;
}

function kindLabel(kind: UpdateItem["kind"], t: { updNew: string; updChanged: string; updCorrection: string; updRollback: string }) {
  if (kind === "discovered") return t.updNew;
  if (kind === "correction") return t.updCorrection;
  if (kind === "rollback") return t.updRollback;
  return t.updChanged;
}

function formatValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function UpdatesView({ items }: { items: UpdateItem[] }) {
  const { lang, t } = useLang();
  return (
    <>
      <p className="kicker">{t.updKicker}</p>
      <h1>{t.updH1}</h1>
      <p className="lede">{t.updLede}</p>
      {items.length === 0 ? (
        <p className="section-sub">{t.updEmpty}</p>
      ) : (
        <ol className="update-list">
          {items.map((it) => {
            const title = lang === "en" ? it.title_en : it.title_id;
            const summary = lang === "en" ? it.summary_en : it.summary_id;
            const kind = kindLabel(it.kind, t);
            const oldValue = formatValue(it.old_value);
            const newValue = formatValue(it.new_value);
            const inner = (
              <>
                <p className="update-meta">
                  <span className="update-kind">{kind}</span>
                  <time dateTime={it.occurred_at}>{fmtWib(it.occurred_at, lang)}</time>
                </p>
                <h2 className="update-title">{title}</h2>
                {summary ? <p className="section-sub">{summary}</p> : null}
                {it.field ? (
                  <p className="section-sub">
                    {it.entity_type} {it.field}
                    {oldValue || newValue ? `: ${oldValue ?? "—"} → ${newValue ?? "—"}` : ""}
                  </p>
                ) : null}
                {it.revision_href ? (
                  <p className="section-sub">
                    {t.updRevision}: {it.revision_id}
                    {it.correction_of ? ` · ${t.updCorrectionOf}: ${it.correction_of}` : ""}
                  </p>
                ) : null}
              </>
            );
            return (
              <li key={String(it.id)} className="update-item">
                {it.href ? (
                  <a className="update-link" href={it.href}>
                    {inner}
                  </a>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
