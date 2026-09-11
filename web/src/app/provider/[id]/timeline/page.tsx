import { notFound } from "next/navigation";
import { getProvider, getProviderTimelineDoc } from "@/lib/db";
import { TimelineView } from "@/components/TimelineView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getProvider(id);
  if (!data) return { title: "Cloud in Asia" };
  return { title: `${data.name} timeline | Cloud in Asia` };
}

export default async function ProviderTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getProvider(id);
  if (!data) notFound();
  const doc = await getProviderTimelineDoc(id);
  return <TimelineView doc={doc} title={data.name} />;
}
