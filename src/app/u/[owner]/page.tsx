import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCatalog, parseCatalogQuery } from "@/lib/catalog";
import { PackageCard } from "@/components/PackageCard";
import { EmptyState } from "@/components/EmptyState";
import { SortSelect } from "@/components/SortSelect";
import { Pagination } from "@/components/Pagination";

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

  const [creator, packages] = await Promise.all([
    catalog.creator(owner),
    catalog.list({
      owner,
      sort: query.sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);
  if (!creator) notFound();

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
          <div className="mt-2 flex items-center gap-3 text-xs text-fg-subtle">
            <span>{creator.packageCount.toLocaleString()} packages</span>
            {creator.url && (
              <a
                href={creator.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:text-accent-hover"
              >
                {creator.url.replace(/^https?:\/\//, "")}
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
