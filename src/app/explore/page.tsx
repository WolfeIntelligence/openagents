import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCatalog, parseCatalogQuery } from "@/lib/catalog";
import { PACKAGE_KINDS, RUNTIME_IDS, type CatalogQuery, type FacetCounts } from "@/lib/types";
import { KIND_META, RUNTIMES } from "@/lib/runtimes";
import { PackageCard } from "@/components/PackageCard";
import { SortSelect } from "@/components/SortSelect";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = {
  title: "Explore",
  description: "Browse agentic workflows, harnesses, rules, and skills.",
};

const PAGE_SIZE = 24;

type RawSearchParams = Record<string, string | string[] | undefined>;

function buildFilterHref(
  current: RawSearchParams,
  key: string,
  value: string | undefined,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (k === "page") continue;
    if (v === undefined) continue;
    if (k === key) continue;
    if (Array.isArray(v)) {
      for (const item of v) params.append(k, item);
    } else {
      params.set(k, v);
    }
  }
  if (value !== undefined) params.set(key, value);
  const qs = params.toString();
  return qs ? `/explore?${qs}` : "/explore";
}

interface ActiveFilter {
  key: string;
  label: string;
}

function activeFilters(query: CatalogQuery): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (query.q) filters.push({ key: "q", label: `Search: “${query.q}”` });
  if (query.kind) filters.push({ key: "kind", label: KIND_META[query.kind]?.label ?? query.kind });
  if (query.runtime) {
    filters.push({ key: "runtime", label: RUNTIMES[query.runtime]?.label ?? query.runtime });
  }
  if (query.price) filters.push({ key: "price", label: query.price === "free" ? "Free" : "Paid" });
  if (query.tag) filters.push({ key: "tag", label: query.tag });
  return filters;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const rawParams = await searchParams;
  const catalog = await getCatalog();
  const query = parseCatalogQuery(rawParams);
  const requestedPage = Math.max(1, Number(rawParams.page) || 1);

  const [initialResult, facets] = await Promise.all([
    catalog.list({ ...query, limit: PAGE_SIZE, offset: (requestedPage - 1) * PAGE_SIZE }),
    // G-S3: counts for the current filtered query, each dimension computed as
    // if its own filter were removed — see the FacetCounts doc comment.
    catalog.facets?.(query)?.catch(() => undefined),
  ]);

  const totalPages = Math.max(1, Math.ceil(initialResult.total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const overflowed = page !== requestedPage && initialResult.total > 0;
  const result = overflowed
    ? await catalog.list({ ...query, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
    : initialResult;

  const filters = activeFilters(query);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Explore</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Browse workflows, harnesses, rules, and skills for your agent runtime.
      </p>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <details className="rounded-lg border border-border lg:hidden">
          <summary className="cursor-pointer list-none rounded-lg px-4 py-3 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
            Filters{filters.length > 0 ? ` (${filters.length})` : ""}
          </summary>
          <div className="border-t border-border px-4 py-4">
            <FiltersContent rawParams={rawParams} query={query} facets={facets} />
          </div>
        </details>

        <aside className="hidden shrink-0 lg:block lg:w-56" aria-label="Filters">
          <FiltersContent rawParams={rawParams} query={query} facets={facets} />
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              {result.total.toLocaleString()} package{result.total === 1 ? "" : "s"}
              {query.q ? (
                <>
                  {" "}
                  for <span className="font-medium text-fg">&ldquo;{query.q}&rdquo;</span>
                </>
              ) : null}
            </p>
            <SortSelect defaultValue={query.sort ?? "updated"} />
          </div>

          {filters.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {filters.map((filter) => (
                <Link
                  key={filter.key}
                  href={buildFilterHref(rawParams, filter.key, undefined)}
                  aria-label={`Remove filter: ${filter.label}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
                >
                  {filter.label}
                  <span aria-hidden="true">&times;</span>
                </Link>
              ))}
              <Link
                href="/explore"
                className="text-xs text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
              >
                Clear all
              </Link>
            </div>
          )}

          {overflowed && (
            <p className="mb-5 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
              Page {requestedPage} doesn&rsquo;t exist &mdash; showing the last page.
            </p>
          )}

          {result.correctedQuery && (
            // G-S1 typo tolerance: "{query.q}" itself had zero hits; this is
            // the corrected query that did match.
            <p className="mb-5 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
              No results for &ldquo;{query.q}&rdquo; &mdash; showing results for{" "}
              <span className="font-medium text-fg">&ldquo;{result.correctedQuery}&rdquo;</span> instead.
            </p>
          )}

          {result.total > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {result.items.map((pkg) => (
                  <PackageCard key={pkg.id} pkg={pkg} />
                ))}
              </div>
              <div className="mt-8">
                <Pagination
                  total={result.total}
                  page={page}
                  pageSize={PAGE_SIZE}
                  searchParams={rawParams}
                  basePath="/explore"
                />
              </div>
            </>
          ) : (
            <EmptyState
              title="No packages match those filters"
              description="Try a different search term or clear a filter."
              action={
                <Link
                  href="/explore"
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:border-border-strong"
                >
                  Clear filters
                </Link>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FiltersContent({
  rawParams,
  query,
  facets,
}: {
  rawParams: RawSearchParams;
  query: CatalogQuery;
  facets?: FacetCounts;
}) {
  // Kind/runtime options with a zero count (for the *other* active filters)
  // are hidden rather than shown as a dead end — same e-commerce-facet
  // convention as the tag list already followed. The currently-active value
  // always stays visible even if its own removed-filter count is zero, so a
  // user can still back out of it. Without facet data (no `facets()` on this
  // catalog), every option shows, matching the pre-G-S3 behaviour.
  const kinds = PACKAGE_KINDS.filter(
    (kind) => !facets || query.kind === kind || (facets.kind[kind] ?? 0) > 0
  );
  const runtimes = RUNTIME_IDS.filter(
    (id) => !facets || query.runtime === id || (facets.runtime[id] ?? 0) > 0
  );
  const showFree = !facets || query.price === "free" || facets.price.free > 0;
  const showPaid = !facets || query.price === "paid" || facets.price.paid > 0;
  const tags = facets?.tags ?? [];

  return (
    <>
      <FilterGroup title="Kind">
        <FilterLink
          href={buildFilterHref(rawParams, "kind", undefined)}
          active={!query.kind}
          label="All kinds"
        />
        {kinds.map((kind) => (
          <FilterLink
            key={kind}
            href={buildFilterHref(rawParams, "kind", kind)}
            active={query.kind === kind}
            label={KIND_META[kind]?.label ?? kind}
            count={facets?.kind[kind]}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Runtime">
        <FilterLink
          href={buildFilterHref(rawParams, "runtime", undefined)}
          active={!query.runtime}
          label="All runtimes"
        />
        {runtimes.map((id) => (
          <FilterLink
            key={id}
            href={buildFilterHref(rawParams, "runtime", id)}
            active={query.runtime === id}
            label={RUNTIMES[id]?.label ?? id}
            count={facets?.runtime[id]}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Price">
        <FilterLink
          href={buildFilterHref(rawParams, "price", undefined)}
          active={!query.price}
          label="All prices"
        />
        {showFree && (
          <FilterLink
            href={buildFilterHref(rawParams, "price", "free")}
            active={query.price === "free"}
            label="Free"
            count={facets?.price.free}
          />
        )}
        {showPaid && (
          <FilterLink
            href={buildFilterHref(rawParams, "price", "paid")}
            active={query.price === "paid"}
            label="Paid"
            count={facets?.price.paid}
          />
        )}
      </FilterGroup>

      {tags.length > 0 && (
        <FilterGroup title="Tags">
          <FilterLink
            href={buildFilterHref(rawParams, "tag", undefined)}
            active={!query.tag}
            label="All tags"
          />
          {tags.map(({ tag, count }) => (
            <FilterLink
              key={tag}
              href={buildFilterHref(rawParams, "tag", tag)}
              active={query.tag === tag}
              label={tag}
              count={count}
            />
          ))}
        </FilterGroup>
      )}
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </h2>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

function FilterLink({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  /** Facet count (G-S3) — omitted when this catalog has no `facets()`. */
  count?: number;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={`flex items-center justify-between gap-2 truncate rounded-md px-2 py-1.5 text-sm ${
          active
            ? "bg-accent-muted font-medium text-accent"
            : "text-fg-muted hover:bg-surface-hover hover:text-fg"
        }`}
      >
        <span className="truncate">{label}</span>
        {count !== undefined && (
          <span className="shrink-0 font-mono text-xs text-fg-subtle">{count}</span>
        )}
      </Link>
    </li>
  );
}
