// Install analytics: one `download_events` row per (package, client, UTC day).
//
// The public `package_stats.downloads` counter used to increment on every hit,
// so a single machine reinstalling in a loop (or a HEAD probe) inflated it. Now
// the download route records an event first and only bumps the counter when the
// event is new for that client today. The rows also feed the seller dashboard
// (downloads over time, by version and by runtime).
//
// Client identity is a salted SHA-256 of the IP: the salt rotates daily, so the
// hash cannot be joined across days or reversed to an address. Safe to import
// with zero env vars: every function no-ops without DATABASE_URL.

import { createHash } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { downloadEvents, downloadRollups } from "@/lib/db/schema";
import { rollupDayRange } from "@/lib/rollups";

export interface DownloadEventInput {
  owner: string;
  name: string;
  version: string;
  runtime?: string | null;
  /** Raw client IP (from `clientIp(request)` in ./ratelimit); hashed here, never stored. */
  ip: string;
}

/** UTC calendar day as YYYY-MM-DD. */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Salted, day-scoped client hash. `DOWNLOAD_HASH_SALT` is optional; without it the
 *  day alone salts the hash, which still prevents cross-day joins. */
export function clientHash(ip: string, day: string = utcDay()): string {
  const salt = process.env.DOWNLOAD_HASH_SALT ?? "";
  return createHash("sha256").update(`${salt}:${day}:${ip}`).digest("hex");
}

/**
 * Records a download event. Returns `true` when this is the first download of
 * the package by this client today (i.e. the public counter should increment),
 * `false` when it was a repeat or the DB is off/unreachable.
 */
export async function recordDownloadEvent(input: DownloadEventInput): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const day = utcDay();
  try {
    const inserted = await db
      .insert(downloadEvents)
      .values({
        owner: input.owner,
        name: input.name,
        version: input.version,
        runtime: input.runtime ?? null,
        clientHash: clientHash(input.ip, day),
        day,
      })
      .onConflictDoNothing({
        target: [downloadEvents.owner, downloadEvents.name, downloadEvents.clientHash, downloadEvents.day],
      })
      .returning({ id: downloadEvents.id });
    return inserted.length > 0;
  } catch {
    // Analytics must never break a download.
    return false;
  }
}

export interface DailyCount {
  day: string;
  count: number;
}

/**
 * Fills a sparse `DailyCount[]` (only days with at least one event) into a dense series
 * of exactly `days` entries — one per UTC calendar day, oldest first, ending on
 * `utcDay(end)` — with `count: 0` for days that had no rows. Pure and synchronous, so
 * `Sparkline` (and any other renderer) always gets a full-width series, including for a
 * brand-new package with zero download events.
 */
export function fillDailySeries(rows: DailyCount[], days: number, end: Date = new Date()): DailyCount[] {
  const counts = new Map(rows.map((r) => [r.day, r.count]));
  const series: DailyCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(new Date(end.getTime() - i * 86_400_000));
    series.push({ day, count: counts.get(day) ?? 0 });
  }
  return series;
}

type Db = NonNullable<ReturnType<typeof getDb>>;

/**
 * Unique downloads per UTC day for one package over the last `days` days.
 *
 * Z5: reads `download_rollups` for every day before today (the nightly cron
 * keeps those current, see src/lib/rollups.ts) and `download_events` directly
 * for today only, since today's rollup doesn't exist yet. Falls back to
 * scanning `download_events` for the whole window when there's no rollup data
 * in range at all — an empty/not-yet-populated rollup table (a fresh
 * deployment, or the cron hasn't run yet) must never make this look like zero
 * downloads.
 */
export async function downloadsByDay(owner: string, name: string, days = 30): Promise<DailyCount[]> {
  const db = getDb();
  if (!db) return [];
  const today = utcDay();
  const since = utcDay(new Date(Date.now() - days * 86_400_000));
  try {
    const [rollupRows, todayRows] = await Promise.all([
      db
        .select({ day: downloadRollups.day, count: downloadRollups.count })
        .from(downloadRollups)
        .where(and(eq(downloadRollups.owner, owner), eq(downloadRollups.name, name), rollupDayRange(since, today)))
        .orderBy(downloadRollups.day),
      todayDownloadCount(db, owner, name, today),
    ]);

    if (rollupRows.length > 0) return [...rollupRows, ...todayRows];

    const fallbackRows = await db
      .select({ day: downloadEvents.day, count: sql<number>`count(*)::int` })
      .from(downloadEvents)
      .where(
        and(eq(downloadEvents.owner, owner), eq(downloadEvents.name, name), gte(downloadEvents.day, since), lt(downloadEvents.day, today))
      )
      .groupBy(downloadEvents.day)
      .orderBy(downloadEvents.day);
    return [...fallbackRows, ...todayRows];
  } catch {
    return [];
  }
}

/** Today's raw `download_events` count for one package, shaped like a
 *  single-element `DailyCount[]` (empty when there were none) — shared by
 *  `downloadsByDay`'s rollup and fallback paths, since today is never in
 *  `download_rollups` either way. */
async function todayDownloadCount(db: Db, owner: string, name: string, today: string): Promise<DailyCount[]> {
  return db
    .select({ day: downloadEvents.day, count: sql<number>`count(*)::int` })
    .from(downloadEvents)
    .where(and(eq(downloadEvents.owner, owner), eq(downloadEvents.name, name), eq(downloadEvents.day, today)))
    .groupBy(downloadEvents.day);
}

export interface KeyedCount {
  key: string;
  count: number;
}

/**
 * Unique downloads grouped by `version` or `runtime` (null runtime → "unknown")
 * over the last `days` days.
 *
 * Z5: merges `download_rollups`' `byVersion`/`byRuntime` jsonb maps (for days
 * before today) with today's raw `download_events`, grouped by the same
 * dimension. Falls back to scanning `download_events` for the whole window
 * when no rollup row in range carries any data for this package — same
 * empty-table safety net as `downloadsByDay`.
 */
export async function downloadsBy(
  owner: string,
  name: string,
  dimension: "version" | "runtime",
  days = 90
): Promise<KeyedCount[]> {
  const db = getDb();
  if (!db) return [];
  const today = utcDay();
  const since = utcDay(new Date(Date.now() - days * 86_400_000));
  const column = dimension === "version" ? downloadEvents.version : downloadEvents.runtime;
  const rollupColumn = dimension === "version" ? downloadRollups.byVersion : downloadRollups.byRuntime;
  try {
    const [rollupRows, todayRows] = await Promise.all([
      db
        .select({ map: rollupColumn })
        .from(downloadRollups)
        .where(and(eq(downloadRollups.owner, owner), eq(downloadRollups.name, name), rollupDayRange(since, today))),
      db
        .select({ key: sql<string>`coalesce(${column}, 'unknown')`, count: sql<number>`count(*)::int` })
        .from(downloadEvents)
        .where(and(eq(downloadEvents.owner, owner), eq(downloadEvents.name, name), eq(downloadEvents.day, today)))
        .groupBy(sql`coalesce(${column}, 'unknown')`),
    ]);

    const merged = new Map<string, number>();
    let hasRollupData = false;
    for (const row of rollupRows) {
      for (const [key, count] of Object.entries(row.map ?? {})) {
        hasRollupData = true;
        merged.set(key, (merged.get(key) ?? 0) + count);
      }
    }

    if (!hasRollupData) {
      const fallbackRows = await db
        .select({ key: sql<string>`coalesce(${column}, 'unknown')`, count: sql<number>`count(*)::int` })
        .from(downloadEvents)
        .where(
          and(
            eq(downloadEvents.owner, owner),
            eq(downloadEvents.name, name),
            gte(downloadEvents.day, since),
            lt(downloadEvents.day, today)
          )
        )
        .groupBy(sql`coalesce(${column}, 'unknown')`);
      for (const row of fallbackRows) merged.set(row.key, (merged.get(row.key) ?? 0) + row.count);
    }

    for (const row of todayRows) merged.set(row.key, (merged.get(row.key) ?? 0) + row.count);

    return Array.from(merged.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

export interface SiteDownloadTotals {
  /** Unique-client-day installs across every package over the trailing 7 days. */
  installsLast7: number;
  /** Same, over the trailing 30 days. */
  installsLast30: number;
}

/** Site-wide install count for one trailing window, merging `download_rollups`
 *  (days before today) with today's raw events — same strategy as
 *  `downloadsByDay`/`downloadsBy`, just summed across every package instead of
 *  scoped to one. Falls back to scanning `download_events` directly when the
 *  rollup table has no rows in range yet. */
async function windowInstalls(db: Db, since: string, today: string): Promise<number> {
  const [rollup, todayCount] = await Promise.all([
    db
      .select({ total: sql<number>`coalesce(sum(${downloadRollups.count}), 0)::int`, rows: sql<number>`count(*)::int` })
      .from(downloadRollups)
      .where(rollupDayRange(since, today))
      .then((r) => r[0] ?? { total: 0, rows: 0 }),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(downloadEvents)
      .where(eq(downloadEvents.day, today))
      .then((r) => r[0]?.total ?? 0),
  ]);

  if (rollup.rows > 0) return rollup.total + todayCount;

  const fallback = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(downloadEvents)
    .where(and(gte(downloadEvents.day, since), lt(downloadEvents.day, today)))
    .then((r) => r[0]?.total ?? 0);
  return fallback + todayCount;
}

/**
 * Site-wide install totals for the admin analytics dashboard (Z5): unique
 * client-days across every package, last 7 and last 30 days. Zero for both
 * when the database is off or either query fails.
 */
export async function siteTotals(): Promise<SiteDownloadTotals> {
  const db = getDb();
  if (!db) return { installsLast7: 0, installsLast30: 0 };
  const today = utcDay();
  try {
    const [installsLast7, installsLast30] = await Promise.all([
      windowInstalls(db, utcDay(new Date(Date.now() - 7 * 86_400_000)), today),
      windowInstalls(db, utcDay(new Date(Date.now() - 30 * 86_400_000)), today),
    ]);
    return { installsLast7, installsLast30 };
  } catch {
    return { installsLast7: 0, installsLast30: 0 };
  }
}
