import { getTrendReport } from "@/lib/db";
import { TrendsView } from "@/components/TrendsView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tren Cloud Directory ASEAN | Cloud in Asia",
  description: "Deret tren dari revisi terverifikasi. Bukan prakiraan AI.",
};

export default async function TrendsPage() {
  const report = await getTrendReport();
  return <TrendsView report={report} />;
}
