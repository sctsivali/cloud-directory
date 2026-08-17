import { notFound } from "next/navigation";
import { getProvider } from "@/lib/db";
import { ProviderView } from "@/components/ProviderView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getProvider(id);
  if (!data) return { title: "Cloud in Asia" };
  return {
    title: `${data.name}: lokasi, stack, paket, dan sumber | Cloud in Asia`,
    description: `Ringkasan publik ${data.name}: kantor pusat ${data.hq_country || "belum tersedia"}, indikator kontrol, stack, dan paket. Bukan endorsement.`,
  };
}

export default async function ProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getProvider(id);
  if (!data) notFound();
  return <ProviderView data={data} />;
}
