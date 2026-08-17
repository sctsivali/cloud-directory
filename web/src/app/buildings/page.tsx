import { getBuildings } from "@/lib/db";
import { BuildingsView } from "@/components/BuildingsView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pusat data ASEAN yang dapat ditelusuri | Cloud in Asia",
  description: "Nama fasilitas, kota, operator, dan penyedia yang menyebut lokasi tersebut dari sumber publik.",
};

export default async function BuildingsPage() {
  const rows = await getBuildings();
  return <BuildingsView rows={rows} />;
}
