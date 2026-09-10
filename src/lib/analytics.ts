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
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { downloadEvents } from "@/lib/db/schema";

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

/** Unique downloads per UTC day for one package over the last `days` days. */
export async function downloadsByDay(owner: string, name: string, days = 30): Promise<DailyCount[]> {
  const db = getDb();
  if (!db) return [];
  const since = utcDay(new Date(Date.now() - days * 86_400_000));
  try {
    const rows = await db
      .select({ day: downloadEvents.day, count: sql<number>`count(*)::int` })
      .from(downloadEvents)
      .where(and(eq(downloadEvents.owner, owner), eq(downloadEvents.name, name), gte(downloadEvents.day, since)))
      .groupBy(downloadEvents.day)
      .orderBy(downloadEvents.day);
    return rows;
  } catch {
    return [];
  }
}

export interface KeyedCount {
  key: string;
  count: number;
}

/** Unique downloads grouped by `version` or `runtime` (null runtime → "unknown"). */
export async function downloadsBy(
  owner: string,
  name: string,
  dimension: "version" | "runtime",
  days = 90
): Promise<KeyedCount[]> {
  const db = getDb();
  if (!db) return [];
  const since = utcDay(new Date(Date.now() - days * 86_400_000));
  const column = dimension === "version" ? downloadEvents.version : downloadEvents.runtime;
  try {
    const rows = await db
      .select({ key: sql<string>`coalesce(${column}, 'unknown')`, count: sql<number>`count(*)::int` })
      .from(downloadEvents)
      .where(and(eq(downloadEvents.owner, owner), eq(downloadEvents.name, name), gte(downloadEvents.day, since)))
      .groupBy(sql`coalesce(${column}, 'unknown')`)
      .orderBy(sql`count(*) desc`);
    return rows;
  } catch {
    return [];
  }
}
