import Link from "next/link";
import type { CollectionSummary } from "@/lib/collections";

/** Card for a collection — mirrors `PackageCard`'s layout so the two read as
 *  one family wherever they appear side by side (the landing rail, /collections). */
export function CollectionCard({ collection }: { collection: CollectionSummary }) {
  return (
    <Link
      href={`/c/${collection.owner}/${collection.slug}`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-fg-subtle">@{collection.owner}</p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-fg group-hover:text-accent">
            {collection.title}
          </h3>
        </div>
        {collection.featured && (
          <span className="inline-flex shrink-0 items-center rounded-full border border-accent-border bg-accent-muted px-2 py-0.5 text-xs font-medium text-fg">
            Featured
          </span>
        )}
      </div>

      {collection.description ? (
        <p className="line-clamp-2 flex-1 text-sm text-fg-muted">{collection.description}</p>
      ) : (
        <p className="flex-1 text-sm text-fg-subtle">No description.</p>
      )}

      <div className="flex items-center gap-4 border-t border-border pt-3 text-xs text-fg-subtle">
        <span>
          {collection.itemCount} {collection.itemCount === 1 ? "package" : "packages"}
        </span>
        {!collection.isPublic && (
          <span className="rounded-full border border-border-strong px-2 py-0.5">Private</span>
        )}
      </div>
    </Link>
  );
}
