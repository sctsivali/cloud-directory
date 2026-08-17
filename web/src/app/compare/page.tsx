import { getArena } from "@/lib/db";
import { CompareView } from "@/components/CompareView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bandingkan shortlist penyedia | Cloud in Asia",
  description: "Bandingkan 2–4 penyedia: yang diketahui dan yang masih perlu ditanya. Bukan rekomendasi final.",
};

export default async function ComparePage() {
  const rows = await getArena();
  return <CompareView rows={rows} />;
}
