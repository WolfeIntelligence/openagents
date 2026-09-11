import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { packages, purchases } from "@/lib/db/schema";
import { getCatalog } from "@/lib/catalog";
import { CATALOG_ALL_LIMIT, type PackageSummary } from "@/lib/types";
import { downloadsBy, downloadsByDay, fillDailySeries, type DailyCount, type KeyedCount } from "@/lib/analytics";
import { netRevenueCents } from "@/lib/stripe";
import { formatPrice } from "@/lib/format";
import { Sparkline } from "@/components/Sparkline";
import { PackageStatusPill } from "./PackageStatusPill";
import { BadgeSnippet } from "@/components/BadgeSnippet";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Downloads, stars, ratings, and sales for the packages you own.",
};

const SPARKLINE_DAYS = 30;

/** Refunded/disputed/failed money never reached (or was clawed back from) the
 *  seller — excluded from sale counts and revenue totals, matching `/settings/payouts`. */
const EXCLUDED_FROM_TOTALS = new Set(["refunded", "disputed", "failed"]);

interface CurrencyTotal {
  currency: string;
  count: number;
  grossCents: number;
  netCents: number;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ pkg?: string }>;
}) {
  const { pkg: selectedId } = await searchParams;

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/dashboard");
  }

  if (!isDbEnabled()) {
    return (
      <Shell>
        <NotConfigured />
      </Shell>
    );
  }

  const handle = session.user.handle;
  if (!handle) {
    return (
      <Shell>
        <p className="text-sm text-fg-muted">
          We don&apos;t have a handle on file for your account yet. Sign out and back in to pick
          one up.
        </p>
      </Shell>
    );
  }

  const catalog = await getCatalog();
  const { items } = await catalog.list({
    owner: handle,
    includeHidden: true,
    limit: CATALOG_ALL_LIMIT,
  });
  const site = siteUrl();

  if (items.length === 0) {
    return (
      <Shell>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-fg-muted">You haven&apos;t published any packages yet.</p>
          <Link
            href="/publish"
            className="mt-3 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            Publish a package
          </Link>
        </div>
      </Shell>
    );
  }

  const db = getDb()!;

  // Sales are only ever recorded against DB-backed packages (`createCheckoutSession`
  // requires a `packages` row), so this join only ever covers a subset of `items`.
  // A failed lookup degrades to "no sales data" rather than a broken dashboard.
  const dbRows = await db
    .select({ id: packages.id, owner: packages.owner, name: packages.name })
    .from(packages)
    .where(eq(packages.owner, handle))
    .catch(() => [] as { id: string; owner: string; name: string }[]);
  const dbIdByKey = new Map(dbRows.map((r) => [`${r.owner}/${r.name}`, r.id]));

  const salesByPackageId = new Map<string, CurrencyTotal[]>();
  const packageIds = dbRows.map((r) => r.id);
  if (packageIds.length > 0) {
    const saleRows = await db
      .select({
        packageId: purchases.packageId,
        currency: sql<string>`coalesce(${purchases.currency}, ${packages.currency})`,
        amountCents: purchases.amountCents,
        status: purchases.status,
      })
      .from(purchases)
      .innerJoin(packages, eq(purchases.packageId, packages.id))
      .where(inArray(purchases.packageId, packageIds));

    for (const row of saleRows) {
      if (EXCLUDED_FROM_TOTALS.has(row.status)) continue;
      const totals = salesByPackageId.get(row.packageId) ?? [];
      let bucket = totals.find((t) => t.currency === row.currency);
      if (!bucket) {
        bucket = { currency: row.currency, count: 0, grossCents: 0, netCents: 0 };
        totals.push(bucket);
      }
      bucket.count += 1;
      bucket.grossCents += row.amountCents;
      bucket.netCents += netRevenueCents(row.amountCents);
      salesByPackageId.set(row.packageId, totals);
    }
  }

  const sparklines = new Map<string, DailyCount[]>(
    await Promise.all(
      items.map(async (item): Promise<[string, DailyCount[]]> => {
        const rows = await downloadsByDay(item.owner, item.name, SPARKLINE_DAYS);
        return [item.id, fillDailySeries(rows, SPARKLINE_DAYS)];
      })
    )
  );

  const selected = items.find((i) => i.id === selectedId) ?? items[0];
  const [byVersion, byRuntime] = await Promise.all([
    downloadsBy(selected.owner, selected.name, "version"),
    downloadsBy(selected.owner, selected.name, "runtime"),
  ]);

  return (
    <Shell>
      <div className="mt-8 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left">
              <th className="px-4 py-2 font-medium text-fg-muted">Package</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Status</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Downloads (30d)</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Total</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Stars</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Rating</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Sales</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <PackageRow
                key={item.id}
                item={item}
                series={sparklines.get(item.id) ?? []}
                totals={
                  (dbIdByKey.has(item.id) && salesByPackageId.get(dbIdByKey.get(item.id)!)) || []
                }
                selected={item.id === selected.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg">
            Breakdown —{" "}
            <Link
              href={`/p/${selected.owner}/${selected.name}`}
              className="font-mono text-accent hover:text-accent-hover"
            >
              {selected.id}
            </Link>
          </h2>
          {items.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {items.map((item) => (
                <Link
                  key={item.id}
                  href={`/dashboard?pkg=${encodeURIComponent(item.id)}`}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    item.id === selected.id
                      ? "border-accent-border bg-accent-muted text-accent"
                      : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <BreakdownTable title="By version" rows={byVersion} />
          <BreakdownTable title="By runtime" rows={byRuntime} />
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-fg">Badges</h2>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          README-ready markdown for each package&apos;s version, downloads, stars, and rating —
          paste directly, no editing needed.
        </p>
        <div className="mt-4 flex flex-col gap-6">
          {items.map((item) => (
            <div key={item.id}>
              <p className="mb-2 font-mono text-sm text-fg">{item.id}</p>
              <BadgeSnippet owner={item.owner} name={item.name} siteUrl={site} />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function PackageRow({
  item,
  series,
  totals,
  selected,
}: {
  item: PackageSummary;
  series: DailyCount[];
  totals: CurrencyTotal[];
  selected: boolean;
}) {
  return (
    <tr className={`border-b border-border last:border-0 ${selected ? "bg-surface" : ""}`}>
      <td className="px-4 py-2">
        <Link
          href={`/dashboard?pkg=${encodeURIComponent(item.id)}`}
          className="font-mono text-accent hover:text-accent-hover"
        >
          {item.id}
        </Link>
      </td>
      <td className="px-4 py-2">
        <PackageStatusPill status={item.status} />
      </td>
      <td className="px-4 py-2">
        <Sparkline
          data={series}
          label={`${item.id} downloads, last ${SPARKLINE_DAYS} days`}
          width={120}
          height={28}
          className="text-accent"
        />
      </td>
      <td className="px-4 py-2 font-mono text-fg">{item.stats.downloads.toLocaleString()}</td>
      <td className="px-4 py-2 font-mono text-fg">{item.stats.stars.toLocaleString()}</td>
      <td className="px-4 py-2 text-fg-muted">
        {item.stats.ratingCount
          ? `${item.stats.ratingAverage!.toFixed(1)} (${item.stats.ratingCount})`
          : "—"}
      </td>
      <td className="px-4 py-2">
        {item.pricing.model === "free" ? (
          <span className="text-fg-subtle">Free</span>
        ) : totals.length === 0 ? (
          <span className="text-fg-subtle">No sales yet</span>
        ) : (
          <div className="flex flex-col gap-0.5">
            {totals.map((t) => (
              <span key={t.currency} className="text-fg-muted">
                {t.count} sale{t.count === 1 ? "" : "s"} ·{" "}
                <span className="font-mono text-fg">{formatPrice(t.netCents, t.currency)}</span> net
              </span>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: KeyedCount[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <h3 className="border-b border-border bg-surface px-4 py-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-muted">No downloads recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-mono text-fg">{row.key}</td>
                <td className="px-4 py-2 text-right font-mono text-fg-muted">
                  {row.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            Downloads, stars, ratings, and sales across every package you own.
          </p>
        </div>
        <Link
          href="/settings/payouts"
          className="text-sm font-medium text-accent hover:text-accent-hover"
        >
          Payouts →
        </Link>
      </div>
      {children}
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
      <p className="text-sm text-fg-muted">This deployment isn&apos;t connected to a database.</p>
      <p className="mt-2 text-xs text-fg-subtle">
        Set <code className="font-mono">DATABASE_URL</code> — see{" "}
        <code className="font-mono">docs/SETUP.md</code>.
      </p>
    </div>
  );
}
