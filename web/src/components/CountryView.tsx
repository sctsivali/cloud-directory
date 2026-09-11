"use client";

import { Flag, flagForCountry } from "./Flag";
import { useLang } from "./Language";
import { TimelineView } from "./TimelineView";
import { TrendsView } from "./TrendsView";
import type { TimelineDocument, TrendReport, CountryRecord } from "@/lib/intelligence";

export function CountryView({
  country,
  timeline,
  trends,
}: {
  country: CountryRecord;
  timeline: TimelineDocument;
  trends: TrendReport;
}) {
  const { lang, t } = useLang();
  const flag = flagForCountry(country.nameEn);
  return (
    <>
      <p className="kicker">
        {t.countryKicker} · {country.iso2}
        {flag ? <Flag code={flag} title={country.nameEn} /> : null}
      </p>
      <h1>{lang === "en" ? country.nameEn : country.nameId}</h1>
      <p className="lede">{t.countryH1}</p>
      <TrendsView report={trends} />
      <TimelineView doc={timeline} title={`${t.navTimeline} · ${country.iso2}`} />
    </>
  );
}
