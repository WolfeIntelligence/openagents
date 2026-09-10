import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { PACKAGE_KINDS } from "@/lib/types";
import { KIND_META } from "@/lib/runtimes";
import { PackageCard } from "@/components/PackageCard";
import { SearchBox } from "@/components/SearchBox";
import { CopyButton } from "@/components/CopyButton";
import { EmptyState } from "@/components/EmptyState";
import { isStripeEnabled, PLATFORM_FEE_BPS } from "@/lib/stripe";

const INSTALL_SNIPPET = "npx openagents add openagents/pr-reviewer";

const STEPS = [
  {
    title: "Find",
    description: "Search or browse workflows, harnesses, rules, and skills built by the community.",
  },
  {
    title: "Install",
    description: "Run one command. OpenAgents drops the package into the right place for your runtime.",
  },
  {
    title: "Run in your agent",
    description: "Claude Code, Cursor, Codex, and other agent runtimes pick it up automatically.",
  },
];

export default async function HomePage() {
  const catalog = await getCatalog();
  const [featured, kindCounts, tags, trending] = await Promise.all([
    catalog.featured(6),
    Promise.all(
      PACKAGE_KINDS.map(async (kind) => {
        const page = await catalog.list({ kind, limit: 1 });
        return [kind, page.total] as const;
      }),
    ),
    // G-C1: top tags, most-used first — catalog.tags() already sorts that way.
    catalog.tags(),
    // G-S4/G-C2: real 7-day unique-download counts; zero in seed-only mode
    // (see sortByTrending in catalog/db.ts), so this rail only renders once
    // there's actually something trending to show.
    catalog.list({ sort: "trending", limit: 6 }),
  ]);
  const counts = Object.fromEntries(kindCounts);
  const paymentsLive = isStripeEnabled();
  const topTags = tags.slice(0, 12);
  // `stats.trending` is only ever set by a real `sort=trending` DB query
  // (see catalog/db.ts's sortByTrending); filtering on it — rather than
  // lifetime downloads — keeps this rail from padding itself with packages
  // that have history but nothing installed this week.
  const trendingItems = trending.items.filter((p) => (p.stats.trending ?? 0) > 0);

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight text-fg sm:text-5xl">
            The open marketplace for agentic workflows
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-fg-muted">
            Find, install, and publish workflows, harnesses, rules, and skills for Claude Code,
            Cursor, Codex, and any agent runtime.
          </p>

          <div className="mx-auto mt-8 max-w-xl">
            <SearchBox size="lg" placeholder="Search “pr review”, “commit messages”, “rag harness”…" />
          </div>

          <div className="mx-auto mt-6 flex max-w-xl items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <code className="overflow-x-auto whitespace-pre font-mono text-sm text-fg">
              {INSTALL_SNIPPET}
            </code>
            <CopyButton value={INSTALL_SNIPPET} />
          </div>
        </div>
      </section>

      {/* Kind tiles */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PACKAGE_KINDS.map((kind) => {
            const meta = KIND_META[kind];
            return (
              <Link
                key={kind}
                href={`/explore?kind=${kind}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-surface-hover"
              >
                <span className="text-xs font-mono text-fg-subtle">
                  {(counts[kind] ?? 0).toLocaleString()} packages
                </span>
                <h3 className="text-base font-semibold text-fg">{meta?.label ?? kind}</h3>
                <p className="text-sm text-fg-muted">{meta?.description}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Featured */}
      <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-fg">Featured packages</h2>
          <Link href="/explore" className="text-sm font-medium text-accent hover:text-accent-hover">
            Browse all →
          </Link>
        </div>
        {featured.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No featured packages yet"
            description="Check back soon, or browse the full catalog."
            action={
              <Link
                href="/explore"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
              >
                Explore packages
              </Link>
            }
          />
        )}
      </section>

      {/* Trending (G-S4/G-C2) — most installed this week, real download_events
          counts. Renders nothing in seed-only/zero-env mode: there's no
          download history to be "most installed" from yet. */}
      {trendingItems.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-fg">Most installed this week</h2>
            <Link
              href="/explore?sort=trending"
              className="text-sm font-medium text-accent hover:text-accent-hover"
            >
              See all →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trendingItems.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        </section>
      )}

      {/* Tags (G-C1) */}
      {topTags.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-fg">Browse by tag</h2>
            <Link href="/tags" className="text-sm font-medium text-accent hover:text-accent-hover">
              All tags →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {topTags.map(({ tag, count }) => (
              <Link
                key={tag}
                href={`/explore?tag=${encodeURIComponent(tag)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                {tag}
                <span className="font-mono text-xs text-fg-subtle">{count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="mb-8 text-xl font-semibold text-fg">How it works</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex flex-col gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-accent-border bg-accent-muted font-mono text-sm font-semibold text-accent">
                {i + 1}
              </span>
              <h3 className="text-base font-semibold text-fg">{step.title}</h3>
              <p className="text-sm text-fg-muted">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Publish CTA */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-border bg-surface p-8 sm:p-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-fg">Publish yours</h2>
                <p className="mt-2 max-w-xl text-sm text-fg-muted">
                  Free packages are always free to publish and free to install — no platform
                  fee, ever.{" "}
                  {paymentsLive ? (
                    <>
                      Charge for a package and keep {100 - PLATFORM_FEE_BPS / 100}% of every
                      sale; OpenAgents takes a {PLATFORM_FEE_BPS / 100}% platform fee to cover
                      payments and hosting.
                    </>
                  ) : (
                    <>
                      Paid packages aren&rsquo;t live yet — see{" "}
                      <Link href="/pricing" className="text-accent hover:text-accent-hover">
                        pricing
                      </Link>{" "}
                      for the terms that will apply.
                    </>
                  )}
                </p>
              </div>
              <Link
                href="/publish"
                className="inline-flex w-fit shrink-0 items-center justify-center rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
              >
                Start publishing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
