import { getMapLinks, getMapSites, getOverview } from "@/lib/db";
import { OverviewView } from "@/components/OverviewView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cloud Directory ASEAN: penyedia, pusat data, teknologi | Cloud in Asia",
  description:
    "Bandingkan penyedia cloud, lokasi pusat data, teknologi, dan indikator kontrol data di Asia Tenggara. Bukan nasihat hukum.",
};

export default async function OverviewPage() {
  const [data, links, sites] = await Promise.all([getOverview(), getMapLinks(), getMapSites()]);
  return <OverviewView data={data} links={links} sites={sites} />;
}
