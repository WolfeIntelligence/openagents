// Real download and star counters.
//
// Every number this module returns is something that actually happened: a
// tarball served from the download endpoint, or a signed-in user pressing the
// star button. Nothing is seeded, estimated, or backfilled — a package with no
// history reports zero, and the UI renders that as "no downloads yet" rather
// than as a count.
//
// Counters are keyed by (owner, name) rather than by a package row id, because
// most of the catalog is seed packages that live on disk and have no row in
// `packages`. See the `package_stats` comment in `./db/schema`.
//
// Safe to import with zero env vars: every function no-ops (or returns empty
// stats) when DATABASE_URL is unset, so the site still works as a read-only
// catalog with no database.

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packageStats, stars } from "@/lib/db/schema";

export interface Stats {
  downloads: number;
  stars: number;
}

export interface PackageRef {
  owner: string;
  name: string;
}

export const ZERO_STATS: Stats = { downloads: 0, stars: 0 };

/** Map key for a package ref. Matches `Package["id"]`. */
export function statsKey(owner: string, name: string): string {
  return `${owner}/${name}`;
}

/**
 * Real counts for the given packages, as a map keyed by "owner/name".
 * Packages with no recorded activity are simply absent from the map — callers
 * should fall back to `ZERO_STATS`. Returns an empty map when the DB is off.
 */
export async function getStats(refs: PackageRef[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>();
  const db = getDb();
  if (!db || refs.length === 0) return out;

  // One query for the whole page. `owner` is low-cardinality and the catalog is
  // small, so filtering on owner and name separately and then matching exact
  // pairs in memory is cheaper than an OR-chain of composite comparisons.
  const owners = Array.from(new Set(refs.map((r) => r.owner)));
  const names = Array.from(new Set(refs.map((r) => r.name)));
  const wanted = new Set(refs.map((r) => statsKey(r.owner, r.name)));

  try {
    const rows = await db
      .select()
      .from(packageStats)
      .where(and(inArray(packageStats.owner, owners), inArray(packageStats.name, names)));

    for (const row of rows) {
      const key = statsKey(row.owner, row.name);
      if (!wanted.has(key)) continue;
      out.set(key, { downloads: row.downloads, stars: row.stars });
    }
  } catch {
    // Database unreachable — report no counts rather than failing the page.
  }

  return out;
}

/** Real counts for a single package. Zero when unrecorded or the DB is off. */
export async function getStatsFor(owner: string, name: string): Promise<Stats> {
  const map = await getStats([{ owner, name }]);
  return map.get(statsKey(owner, name)) ?? ZERO_STATS;
}

/**
 * Records one download. Called from the download endpoint, which is the single
 * path every install takes — the website button, the CLI, and direct API use all
 * go through it. No-ops when the DB is off.
 */
export async function recordDownload(owner: string, name: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db
      .insert(packageStats)
      .values({ owner, name, downloads: 1, stars: 0 })
      .onConflictDoUpdate({
        target: [packageStats.owner, packageStats.name],
        set: { downloads: sql`${packageStats.downloads} + 1` },
      });
  } catch {
    // A failed counter write must never fail the download itself.
  }
}

/** Whether this user has starred this package. False when the DB is off. */
export async function isStarred(
  userId: string,
  owner: string,
  name: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const [row] = await db
      .select({ owner: stars.owner })
      .from(stars)
      .where(and(eq(stars.userId, userId), eq(stars.owner, owner), eq(stars.name, name)))
      .limit(1);
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Adds or removes this user's star, then republishes the package's star count as
 * the true number of star rows. Returns the new state, or null when the DB is off.
 */
export async function toggleStar(
  userId: string,
  owner: string,
  name: string
): Promise<{ starred: boolean; stars: number } | null> {
  const db = getDb();
  if (!db) return null;

  const mine = and(eq(stars.userId, userId), eq(stars.owner, owner), eq(stars.name, name));

  try {
    const [existing] = await db.select({ owner: stars.owner }).from(stars).where(mine).limit(1);
    const starred = !existing;

    if (starred) {
      await db.insert(stars).values({ userId, owner, name }).onConflictDoNothing();
    } else {
      await db.delete(stars).where(mine);
    }

    // Recount rather than increment: the count is derived state, so it can never
    // drift away from the actual stars even if a write is retried or races.
    const [counted] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(stars)
      .where(and(eq(stars.owner, owner), eq(stars.name, name)));
    const total = counted?.count ?? 0;

    await db
      .insert(packageStats)
      .values({ owner, name, downloads: 0, stars: total })
      .onConflictDoUpdate({
        target: [packageStats.owner, packageStats.name],
        set: { stars: total },
      });

    return { starred, stars: total };
  } catch {
    // Most likely the schema hasn't been pushed yet (`npm run db:push`), so the
    // tables this needs don't exist. Report unavailable rather than inventing a
    // result the database never stored.
    return null;
  }
}
