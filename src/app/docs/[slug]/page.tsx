import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllDocs, getDoc } from "../docs-source";
import { DocsSidebar } from "@/components/DocsSidebar";
import { Markdown } from "@/components/Markdown";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return getAllDocs().map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return { title: "Not found" };
  return { title: doc.title, description: doc.description };
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  const docs = getAllDocs();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8 lg:flex-row">
        <DocsSidebar docs={docs} activeSlug={slug} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-fg">{doc.title}</h1>
          {doc.description && <p className="mt-1 text-sm text-fg-muted">{doc.description}</p>}
          <div className="mt-6">
            <Markdown content={doc.content} />
          </div>
        </div>
      </div>
    </div>
  );
}
