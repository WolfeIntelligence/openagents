import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isDbEnabled } from "@/lib/db/client";
import { listCollections } from "@/lib/collections";
import { CollectionCard } from "@/components/CollectionCard";
import { EmptyState } from "@/components/EmptyState";
import { CATALOG_ALL_LIMIT } from "@/lib/types";

export const metadata: Metadata = {
  title: "Collections",
  description: "Curated, ordered lists of packages put together by the community.",
};

// /collections — featured collections first, then newest public ones;
// `?q=` filters by title. Zero-env safe: with no database this renders a
// "not configured" state rather than an empty grid.
export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  if (!isDbEnabled()) {
    return (
      <PageShell q={q}>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-fg-muted">
            Collections require a database, which isn&apos;t configured on this deployment.
          </p>
        </div>
      </PageShell>
    );
  }

  // A dedicated ceiling, not the request-facing API default — this listing
  // page wants "every public collection that matches", not one API page of
  // them. Mirrors CATALOG_ALL_LIMIT's role in sitemap.ts.
  const { items } = await listCollections({ q, limit: Math.min(CATALOG_ALL_LIMIT, 200) });

  return (
    <PageShell q={q}>
      {items.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <CollectionCard key={c.id} collection={c} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={q ? "No collections match that search" : "No collections yet"}
          description={q ? "Try a different title." : "Be the first to publish one."}
          action={
            <Link
              href="/collections/new"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              New collection
            </Link>
          }
        />
      )}
    </PageShell>
  );
}

function PageShell({ q, children }: { q?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Collections</h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            Curated, ordered lists of packages put together by the community.
          </p>
        </div>
        <Link
          href="/collections/new"
          className="inline-flex shrink-0 items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          New collection
        </Link>
      </div>
      <form action="/collections" method="get" className="mb-8 max-w-md">
        <label htmlFor="collections-q" className="sr-only">
          Search collections
        </label>
        <input
          id="collections-q"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search collections…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
        />
      </form>
      {children}
    </div>
  );
}
