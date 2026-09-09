import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCatalog, parseCatalogQuery } from "@/lib/catalog";
import { PACKAGE_KINDS, RUNTIME_IDS } from "@/lib/types";
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

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const rawParams = await searchParams;
  const catalog = await getCatalog();
  const query = parseCatalogQuery(rawParams);
  const page = Math.max(1, Number(rawParams.page) || 1);

  const [result, tags] = await Promise.all([
    catalog.list({ ...query, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    catalog.tags(),
  ]);
  const topTags = tags.slice(0, 20);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Explore</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Browse workflows, harnesses, rules, and skills for your agent runtime.
      </p>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <aside className="shrink-0 lg:w-56" aria-label="Filters">
          <FilterGroup title="Kind">
            <FilterLink
              href={buildFilterHref(rawParams, "kind", undefined)}
              active={!query.kind}
              label="All kinds"
            />
            {PACKAGE_KINDS.map((kind) => (
              <FilterLink
                key={kind}
                href={buildFilterHref(rawParams, "kind", kind)}
                active={query.kind === kind}
                label={KIND_META[kind]?.label ?? kind}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Runtime">
            <FilterLink
              href={buildFilterHref(rawParams, "runtime", undefined)}
              active={!query.runtime}
              label="All runtimes"
            />
            {RUNTIME_IDS.map((id) => (
              <FilterLink
                key={id}
                href={buildFilterHref(rawParams, "runtime", id)}
                active={query.runtime === id}
                label={RUNTIMES[id]?.label ?? id}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Price">
            <FilterLink
              href={buildFilterHref(rawParams, "price", undefined)}
              active={!query.price}
              label="All prices"
            />
            <FilterLink
              href={buildFilterHref(rawParams, "price", "free")}
              active={query.price === "free"}
              label="Free"
            />
            <FilterLink
              href={buildFilterHref(rawParams, "price", "paid")}
              active={query.price === "paid"}
              label="Paid"
            />
          </FilterGroup>

          {topTags.length > 0 && (
            <FilterGroup title="Tags">
              <FilterLink
                href={buildFilterHref(rawParams, "tag", undefined)}
                active={!query.tag}
                label="All tags"
              />
              {topTags.map(({ tag, count }) => (
                <FilterLink
                  key={tag}
                  href={buildFilterHref(rawParams, "tag", tag)}
                  active={query.tag === tag}
                  label={`${tag} (${count})`}
                />
              ))}
            </FilterGroup>
          )}
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

          {result.items.length > 0 ? (
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

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </h2>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={`block truncate rounded-md px-2 py-1.5 text-sm ${
          active
            ? "bg-accent-muted font-medium text-accent"
            : "text-fg-muted hover:bg-surface-hover hover:text-fg"
        }`}
      >
        {label}
      </Link>
    </li>
  );
}
