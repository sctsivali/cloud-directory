import { notFound } from "next/navigation";
import { getPlansForProviders, getStacks } from "@/lib/db";
import { stackBlob, techBySlug, techsForBlob } from "@/lib/tech";
import { TechView } from "@/components/TechView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tech = techBySlug(slug);
  if (!tech) return { title: "Cloud in Asia" };
  return {
    title: `${tech.name}: fungsi, trade-off, dan penyedia | Cloud in Asia`,
    description: tech.id.lead,
  };
}

export default async function TechDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tech = techBySlug(slug);
  if (!tech) notFound();
  const stacks = await getStacks();
  const providers = stacks.filter((s) => techsForBlob(stackBlob(s)).some((x) => x.slug === tech.slug));
  const plans = (await getPlansForProviders(providers.map((p) => p.id))).slice(0, 24);
  return <TechView tech={tech} providers={providers} plans={plans} />;
}
