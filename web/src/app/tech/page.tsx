import { getStacks } from "@/lib/db";
import { TechListView } from "@/components/TechListView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Teknologi cloud: hypervisor, kontainer, storage | Cloud in Asia",
  description: "Panduan netral tentang stack cloud dan penyedia yang menyebutnya. Bukan promosi merek.",
};

export default async function TechPage() {
  const stacks = await getStacks();
  return <TechListView stacks={stacks} />;
}
