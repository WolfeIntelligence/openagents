// Data layer for /admin/analytics and its JSON twin, GET /api/v1/admin/analytics
// (Z5). One function, `getAdminAnalytics`, shared by both so the page and the
// API can never drift on what a number means. Callers are responsible for the
// admin check (see isAdmin in src/lib/admin.ts) and for isDbEnabled() — this
// module assumes both already passed and simply returns `null` if getDb() is
// somehow still unavailable, so a caller has one thing to check either way.
//
// Every query here reads download totals through src/lib/analytics.ts's
// rollup-aware helpers (siteTotals) or duplicates their rollup+fallback merge
// pattern locally for shapes analytics.ts doesn't expose (per-day, per-package)
// — see the doc comments on installsPerDaySeries/topInstalledPackages below.

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  downloadEvents,
  downloadRollups,
  packages,
  purchases,
  refundRequests,
  reports,
  reviews,
  stars,
  users,
} from "@/lib/db/schema";
import { rollupDayRange } from "@/lib/rollups";
import { fillDailySeries, siteTotals, utcDay, type DailyCount } from "@/lib/analytics";
import { netRevenueCents } from "@/lib/stripe";

type Db = NonNullable<ReturnType<typeof getDb>>;

export interface WeeklyCount {
  /** Monday of the week, UTC, YYYY-MM-DD. */
  weekStart: string;
  count: number;
}

export interface TopPackage {
  owner: string;
  name: string;
  title: string;
  installs: number;
}

export interface AdminAnalytics {
  totals: {
    users: number;
    /** Keyed by PackageStatus ("pending" | "live" | "unlisted" | "deprecated"); a
     *  status with zero packages is simply absent. */
    packagesByStatus: Record<string, number>;
    installsLast7: number;
    installsLast30: number;
    stars: number;
    reviews: number;
    openReports: number;
    pendingPackages: number;
    /** `null` when the query itself failed (e.g. `refund_requests` not migrated
     *  yet on this deployment) rather than 0, so the UI can distinguish
     *  "genuinely zero" from "couldn't check". */
    openRefundRequests: number | null;
  };
  /** Paid purchases in the last 30 days, by currency. */
  revenueLast30: {
    count: number;
    grossByCurrency: Record<string, number>;
    netByCurrency: Record<string, number>;
  };
  /** Top 10 packages by installs in the last 30 days. */
  topPackages: TopPackage[];
  /** Last 12 calendar weeks (UTC, Monday-start), oldest first. */
  signupsPerWeek: WeeklyCount[];
  /** Last `days` days, oldest first — same dense/zero-filled shape `Sparkline` expects. */
  installsPerDay: DailyCount[];
}

const MS_PER_DAY = 86_400_000;

function utcWeekStart(date: Date): string {
  const truncated = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDayOfWeek = ((truncated.getUTCDay() + 6) % 7) + 1; // Mon=1 .. Sun=7
  truncated.setUTCDate(truncated.getUTCDate() - (isoDayOfWeek - 1));
  return truncated.toISOString().slice(0, 10);
}

function fillWeeklySeries(rows: { week: string; count: number }[], weeks: number, end: Date = new Date()): WeeklyCount[] {
  const counts = new Map(rows.map((r) => [r.week, r.count]));
  const series: WeeklyCount[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = utcWeekStart(new Date(end.getTime() - i * 7 * MS_PER_DAY));
    series.push({ weekStart, count: counts.get(weekStart) ?? 0 });
  }
  return series;
}

/** New-user signups bucketed into their UTC ISO week, last `weeks` weeks
 *  (zero-filled — a quiet week isn't just missing from the series). Buckets in
 *  JS rather than a SQL `date_trunc` grouping, since the `user` table is small
 *  enough that fetching `createdAt` for the window and counting in memory is
 *  simpler than getting ISO-week semantics exactly right across drivers. */
async function signupsPerWeekSeries(db: Db, weeks = 12): Promise<WeeklyCount[]> {
  const since = new Date(Date.now() - weeks * 7 * MS_PER_DAY);
  const rows = await db.select({ createdAt: users.createdAt }).from(users).where(gte(users.createdAt, since));
  const counts = new Map<string, number>();
  for (const row of rows) {
    const week = utcWeekStart(row.createdAt);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  return fillWeeklySeries(Array.from(counts, ([week, count]) => ({ week, count })), weeks);
}

/** Site-wide installs per day for the sparkline: `download_rollups` summed per
 *  day (before today) plus today's raw events, dense-filled to exactly `days`
 *  entries via `fillDailySeries`. Falls back to scanning raw events for the
 *  whole window when there are no rollup rows in range — see the identical
 *  fallback reasoning on `downloadsByDay` in src/lib/analytics.ts. */
async function installsPerDaySeries(db: Db, days: number): Promise<DailyCount[]> {
  const today = utcDay();
  const since = utcDay(new Date(Date.now() - days * MS_PER_DAY));

  const [rollupRows, todayRows] = await Promise.all([
    db
      .select({ day: downloadRollups.day, count: sql<number>`sum(${downloadRollups.count})::int` })
      .from(downloadRollups)
      .where(rollupDayRange(since, today))
      .groupBy(downloadRollups.day),
    db
      .select({ day: downloadEvents.day, count: sql<number>`count(*)::int` })
      .from(downloadEvents)
      .where(eq(downloadEvents.day, today))
      .groupBy(downloadEvents.day),
  ]);

  if (rollupRows.length > 0) return fillDailySeries([...rollupRows, ...todayRows], days);

  const fallbackRows = await db
    .select({ day: downloadEvents.day, count: sql<number>`count(*)::int` })
    .from(downloadEvents)
    .where(and(gte(downloadEvents.day, since), lt(downloadEvents.day, today)))
    .groupBy(downloadEvents.day);
  return fillDailySeries([...fallbackRows, ...todayRows], days);
}

/** Top packages by 30-day installs: same rollup-sum-plus-today merge as
 *  `installsPerDaySeries`, just grouped by (owner, name) instead of by day, then
 *  joined against `packages` for a display title (falling back to the bare name
 *  for a seed-only package with no `packages` row). */
async function topInstalledPackages(db: Db, limit: number): Promise<TopPackage[]> {
  const today = utcDay();
  const since = utcDay(new Date(Date.now() - 30 * MS_PER_DAY));

  const [rollupRows, todayRows] = await Promise.all([
    db
      .select({
        owner: downloadRollups.owner,
        name: downloadRollups.name,
        count: sql<number>`sum(${downloadRollups.count})::int`,
      })
      .from(downloadRollups)
      .where(rollupDayRange(since, today))
      .groupBy(downloadRollups.owner, downloadRollups.name),
    db
      .select({ owner: downloadEvents.owner, name: downloadEvents.name, count: sql<number>`count(*)::int` })
      .from(downloadEvents)
      .where(eq(downloadEvents.day, today))
      .groupBy(downloadEvents.owner, downloadEvents.name),
  ]);

  const bySource =
    rollupRows.length > 0
      ? rollupRows
      : await db
          .select({ owner: downloadEvents.owner, name: downloadEvents.name, count: sql<number>`count(*)::int` })
          .from(downloadEvents)
          .where(and(gte(downloadEvents.day, since), lt(downloadEvents.day, today)))
          .groupBy(downloadEvents.owner, downloadEvents.name);

  const merged = new Map<string, number>();
  for (const row of bySource) merged.set(`${row.owner}/${row.name}`, (merged.get(`${row.owner}/${row.name}`) ?? 0) + row.count);
  for (const row of todayRows) merged.set(`${row.owner}/${row.name}`, (merged.get(`${row.owner}/${row.name}`) ?? 0) + row.count);

  const ranked = Array.from(merged.entries())
    .map(([key, installs]) => {
      const slash = key.indexOf("/");
      return { owner: key.slice(0, slash), name: key.slice(slash + 1), installs };
    })
    .sort((a, b) => b.installs - a.installs)
    .slice(0, limit);

  if (ranked.length === 0) return [];

  const titleRows = await db.select({ owner: packages.owner, name: packages.name, title: packages.title }).from(packages);
  const titleByKey = new Map(titleRows.map((r) => [`${r.owner}/${r.name}`, r.title]));

  return ranked.map((r) => ({ ...r, title: titleByKey.get(`${r.owner}/${r.name}`) ?? r.name }));
}

/** Open `refund_requests` count, or `null` if the query fails — that table
 *  ships in the same batch-4 migration as everything else this workstream
 *  depends on, but a deployment that hasn't run migrations yet (or rolled back
 *  a step) shouldn't 500 the whole dashboard over one missing table. */
async function openRefundRequestsCount(db: Db): Promise<number | null> {
  try {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(refundRequests)
      .where(eq(refundRequests.status, "open"));
    return rows[0]?.count ?? 0;
  } catch (err) {
    console.error("[admin/analytics] refund_requests query failed (table may not exist yet):", err);
    return null;
  }
}

/**
 * Assembles every number/series the admin analytics dashboard shows. Returns
 * `null` only when there's no database at all — callers should have already
 * checked `isDbEnabled()`, so this is a belt-and-suspenders guard, not the
 * normal path.
 */
export async function getAdminAnalytics(days = 30): Promise<AdminAnalytics | null> {
  const db = getDb();
  if (!db) return null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * MS_PER_DAY);

  const [
    userCount,
    statusRows,
    installTotals,
    starCount,
    reviewCount,
    purchaseRows,
    openReportCount,
    pendingCount,
    openRefundRequests,
    topPackages,
    signupsPerWeek,
    installsPerDay,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .then((r) => r[0]?.count ?? 0),
    db.select({ status: packages.status, count: sql<number>`count(*)::int` }).from(packages).groupBy(packages.status),
    siteTotals(),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(stars)
      .then((r) => r[0]?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews)
      .then((r) => r[0]?.count ?? 0),
    db
      .select({
        currency: purchases.currency,
        gross: sql<number>`coalesce(sum(${purchases.amountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(purchases)
      .where(and(eq(purchases.status, "paid"), gte(purchases.createdAt, thirtyDaysAgo)))
      .groupBy(purchases.currency),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
      .where(eq(reports.status, "open"))
      .then((r) => r[0]?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(packages)
      .where(eq(packages.status, "pending"))
      .then((r) => r[0]?.count ?? 0),
    openRefundRequestsCount(db),
    topInstalledPackages(db, 10),
    signupsPerWeekSeries(db, 12),
    installsPerDaySeries(db, days),
  ]);

  const packagesByStatus: Record<string, number> = {};
  for (const row of statusRows) packagesByStatus[row.status] = row.count;

  const grossByCurrency: Record<string, number> = {};
  const netByCurrency: Record<string, number> = {};
  let purchaseCount = 0;
  for (const row of purchaseRows) {
    const currency = row.currency ?? "usd";
    grossByCurrency[currency] = (grossByCurrency[currency] ?? 0) + row.gross;
    netByCurrency[currency] = (netByCurrency[currency] ?? 0) + netRevenueCents(row.gross);
    purchaseCount += row.count;
  }

  return {
    totals: {
      users: userCount,
      packagesByStatus,
      installsLast7: installTotals.installsLast7,
      installsLast30: installTotals.installsLast30,
      stars: starCount,
      reviews: reviewCount,
      openReports: openReportCount,
      pendingPackages: pendingCount,
      openRefundRequests,
    },
    revenueLast30: { count: purchaseCount, grossByCurrency, netByCurrency },
    topPackages,
    signupsPerWeek,
    installsPerDay,
  };
}
