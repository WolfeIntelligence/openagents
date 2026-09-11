import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getCatalog, parseCatalogQuery } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getCreatorTotals } from "@/lib/stats";
import { PackageCard } from "@/components/PackageCard";
import { EmptyState } from "@/components/EmptyState";
import { SortSelect } from "@/components/SortSelect";
import { Pagination } from "@/components/Pagination";
import { RatingStars } from "@/components/RatingStars";
import { listCollectionsForOwner } from "@/lib/collections";
import { CollectionCard } from "@/components/CollectionCard";

type Params = { owner: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 24;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { owner } = await params;
  const catalog = await getCatalog();
  const creator = await catalog.creator(owner);
  if (!creator) return { title: "Creator not found" };
  return { title: creator.displayName, description: creator.bio };
}

export default async function CreatorPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { owner } = await params;
  const rawParams = await searchParams;
  const catalog = await getCatalog();
  const query = parseCatalogQuery(rawParams);
  const page = Math.max(1, Number(rawParams.page) || 1);

  const session = await auth();
  const isViewerOwner = Boolean(session?.user?.handle && session.user.handle === owner);

  const [creator, packages, totals, collections] = await Promise.all([
    catalog.creator(owner),
    catalog.list({
      owner,
      sort: query.sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      // Owners get to see their own pending/unlisted packages here too — everyone
      // else only sees what's actually live (plus deprecated).
      includeHidden: isViewerOwner,
    }),
    getCreatorTotals(owner),
    listCollectionsForOwner(owner),
  ]);
  if (!creator) notFound();

  // `catalog.creator` doesn't surface `users.website` for DB-backed users (only
  // a seed owner's `owner.json` "url"), so read it directly here too, same as
  // `/api/v1/users/[handle]`.
  let website: string | null = creator.url ?? null;
  // Likewise for `users.createdAt` — seed catalog owners (owner.json on disk) have
  // no signup date at all, so this stays null for them.
  let joinedAt: string | null = null;
  const db = getDb();
  if (db) {
    try {
      const [row] = await db
        .select({ website: users.website, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.handle, owner))
        .limit(1);
      if (row?.website) website = row.website;
      if (row?.createdAt) {
        joinedAt = row.createdAt.toLocaleDateString(undefined, { year: "numeric", month: "short" });
      }
    } catch {
      // Fall back to whatever the seed catalog provided.
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start gap-4 border-b border-border pb-8 sm:flex-row sm:items-center">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-hover text-2xl text-fg-muted">
          {creator.displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">{creator.displayName}</h1>
          <p className="font-mono text-sm text-fg-subtle">@{creator.handle}</p>
          {creator.bio && <p className="mt-1.5 max-w-xl text-sm text-fg-muted">{creator.bio}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
            <span>{creator.packageCount.toLocaleString()} packages</span>
            {totals.stars > 0 && <span>{totals.stars.toLocaleString()} stars</span>}
            {totals.downloads > 0 && <span>{totals.downloads.toLocaleString()} downloads</span>}
            {totals.ratingCount ? (
              <RatingStars average={totals.ratingAverage} count={totals.ratingCount} />
            ) : null}
            {joinedAt && <span>Joined {joinedAt}</span>}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:text-accent-hover"
              >
                {website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8">
        {packages.total > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              {packages.total.toLocaleString()} package{packages.total === 1 ? "" : "s"}
            </p>
            <SortSelect defaultValue={query.sort ?? "updated"} />
          </div>
        )}

        {collections.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              Collections
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {collections.map((c) => (
                <CollectionCard key={c.id} collection={c} />
              ))}
            </div>
          </section>
        )}
        {packages.items.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {packages.items.map((pkg) => (
                <PackageCard key={pkg.id} pkg={pkg} />
              ))}
            </div>
            <div className="mt-8">
              <Pagination
                total={packages.total}
                page={page}
                pageSize={PAGE_SIZE}
                searchParams={rawParams}
                basePath={`/u/${owner}`}
              />
            </div>
          </>
        ) : (
          <EmptyState
            title="No published packages yet"
            description={`${creator.displayName} hasn't published any packages.`}
          />
        )}
      </div>
    </div>
  );
}
