import { getArena } from "@/lib/db";
import { ArenaView } from "@/components/ArenaView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bandingkan penyedia cloud ASEAN | Cloud in Asia",
  description: "Shortlist penyedia berdasarkan kontrol data, open technology, harga, cakupan, dan kapasitas.",
};

export default async function ArenaPage() {
  const rows = await getArena();
  return <ArenaView rows={rows} />;
}
