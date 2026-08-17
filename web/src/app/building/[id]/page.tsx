import { notFound } from "next/navigation";
import { getBuilding } from "@/lib/db";
import { BuildingView } from "@/components/BuildingView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isFinite(n)) return { title: "Cloud in Asia" };
  const data = await getBuilding(n);
  if (!data) return { title: "Cloud in Asia" };
  if (!data.listed) {
    return {
      title: `Lokasi pusat data belum terverifikasi di ${data.city} | Cloud in Asia`,
      robots: { index: false, follow: false },
    };
  }
  return {
    title: `${data.name}, ${data.city}: operator dan penyedia | Cloud in Asia`,
  };
}

export default async function BuildingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isFinite(n)) notFound();
  const data = await getBuilding(n);
  if (!data) notFound();
  return <BuildingView data={data} />;
}
