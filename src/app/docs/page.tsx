import Link from "next/link";
import type { Metadata } from "next";
import { getAllDocs } from "./docs-source";
import { DocsSidebar } from "@/components/DocsSidebar";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = {
  title: "Docs",
  description: "Package format, publishing, CLI, runtimes, and pricing docs.",
};

export default function DocsIndexPage() {
  const docs = getAllDocs();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Documentation</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Everything you need to install, run, and publish OpenAgents packages.
      </p>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        {docs.length > 0 && <DocsSidebar docs={docs} />}
        <div className="min-w-0 flex-1">
          {docs.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {docs.map((doc) => (
                <Link
                  key={doc.slug}
                  href={`/docs/${doc.slug}`}
                  className="rounded-lg border border-border bg-surface p-4 hover:border-border-strong hover:bg-surface-hover"
                >
                  <h2 className="text-sm font-semibold text-fg">{doc.title}</h2>
                  {doc.description && (
                    <p className="mt-1 text-sm text-fg-muted">{doc.description}</p>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No docs yet"
              description="Documentation pages will appear here once they're added to src/content/docs."
            />
          )}
        </div>
      </div>
    </div>
  );
}
