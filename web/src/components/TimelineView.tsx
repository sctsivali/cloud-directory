"use client";

import { useLang } from "./Language";
import type { TimelineDocument } from "@/lib/intelligence";

export function TimelineView({ doc, title }: { doc: TimelineDocument; title: string }) {
  const { t } = useLang();
  return (
    <>
      <p className="kicker">{t.timelineKicker}</p>
      <h1>{title}</h1>
      <p className="lede">{t.timelineH1}</p>
      <p className="section-sub">
        {t.trendsProvenance}: {doc.methodologyVersion} · {doc.methodologyHash.slice(0, 12)} · {doc.dataRevision}
      </p>
      {doc.events.length === 0 ? (
        <p className="section-sub">{t.timelineEmpty}</p>
      ) : (
        <ol className="rule-list">
          {doc.events.map((event) => (
            <li key={event.receiptId}>
              {event.observedAt.slice(0, 10)} · {event.changeType} · {event.entityType}/{event.entityId}/{event.fieldName}
              {event.conflict ? ` · ${t.outlookSignal}: conflict` : ""}
              {event.stale ? ` · ${t.trendsInsufficient}` : ""}
              {" "}
              <span className="meta">{event.revisionId}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
