"use client";

import { useLang } from "./Language";

export type UpdateItem = {
  id: number;
  kind: "discovered" | "updated";
  provider_id: string | null;
  title_id: string;
  title_en: string;
  summary_id: string | null;
  summary_en: string | null;
  href: string | null;
  occurred_at: string;
};

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
            const kind = it.kind === "discovered" ? t.updNew : t.updChanged;
            const inner = (
              <>
                <p className="update-meta">
                  <span className="update-kind">{kind}</span>
                  <time dateTime={it.occurred_at}>{fmtWib(it.occurred_at, lang)}</time>
                </p>
                <h2 className="update-title">{title}</h2>
                {summary ? <p className="section-sub">{summary}</p> : null}
              </>
            );
            return (
              <li key={it.id} className="update-item">
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
