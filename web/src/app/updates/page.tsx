import { getDirectoryUpdates } from "@/lib/db";
import { UpdatesView } from "@/components/UpdatesView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pembaruan data Cloud Directory ASEAN | Cloud in Asia",
  description:
    "Daftar penyedia yang baru ditemukan dan data lama yang baru diperbarui di Cloud Directory, lengkap dengan tanggal dan jam WIB. Sumber publik, bukan nasihat hukum.",
  alternates: { canonical: "https://guide.cloudin.asia/updates" },
  openGraph: {
    title: "Pembaruan data Cloud Directory ASEAN",
    description:
      "Penyedia baru dan pembaruan harga, gedung, serta stack dari situs resmi.",
    url: "https://guide.cloudin.asia/updates",
    type: "website",
  },
};

export default async function UpdatesPage() {
  const items = await getDirectoryUpdates();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Pembaruan Cloud Directory ASEAN",
    url: "https://guide.cloudin.asia/updates",
    inLanguage: ["id", "en"],
    isPartOf: { "@type": "WebSite", name: "Cloud Directory", url: "https://guide.cloudin.asia/" },
    about: "Pembaruan editorial harga, lokasi, dan stack penyedia cloud ASEAN",
    dateModified: items[0]?.occurred_at ?? undefined,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.slice(0, 30).map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: it.href ? `https://guide.cloudin.asia${it.href}` : "https://guide.cloudin.asia/updates",
        name: it.title_id,
        datePublished: it.occurred_at,
      })),
    },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <UpdatesView items={items} />
    </>
  );
}
