import { getArena } from "@/lib/db";
import { StartResultView } from "@/components/StartResultView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Fokus perbandingan Anda | Cloud in Asia",
  description: "Shortlist 2–4 penyedia, unknown, dan checklist validasi. Screening awal, bukan keputusan final.",
};

export default async function StartResultPage() {
  const rows = await getArena();
  return <StartResultView rows={rows} />;
}
