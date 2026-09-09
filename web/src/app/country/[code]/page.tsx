import { notFound } from "next/navigation";
import { getCountryPageData } from "@/lib/db";
import { CountryView } from "@/components/CountryView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  try {
    const data = await getCountryPageData(code);
    return { title: `${data.country.nameEn} | Cloud Directory ASEAN` };
  } catch {
    return { title: "Cloud in Asia" };
  }
}

export default async function CountryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  try {
    const data = await getCountryPageData(code);
    return <CountryView country={data.country} timeline={data.timeline} trends={data.trends} />;
  } catch {
    notFound();
  }
}
