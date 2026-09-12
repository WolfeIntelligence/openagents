import { and, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { apiTokens, downloadEvents, rateLimits } from "@/lib/db/schema";
import { requireCronAuth } from "@/lib/cron";
import { utcDay } from "@/lib/analytics";
import { RAW_EVENT_RETENTION_DAYS } from "@/lib/rollups";

export const runtime = "nodejs";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

interface CleanupStats {
  rateLimitsDeleted: number;
  tokensDeleted: number;
  eventsDeleted: number;
}

/**
 * Three unrelated bits of routine table upkeep, batched into one hourly cron
 * rather than three:
 *
 *  - `rate_limits` rows whose window closed over a day ago (mirrors the
 *    opportunistic cleanup `rateLimitDurable` already does on ~1/200 calls —
 *    this is the guaranteed backstop for a deployment with too little traffic
 *    to trigger that often).
 *  - `api_tokens` that were revoked more than 30 days ago (kept briefly after
 *    revocation in case support needs to look one up; not kept forever).
 *  - `download_events` rows already condensed into `download_rollups` and past
 *    the retention window — a backstop for `rollupDownloads`'s own end-of-run
 *    delete (src/lib/rollups.ts), in case that cron didn't run. Only deletes
 *    events with a matching rollup row, so a day that was never rolled up
 *    (rollup cron down, say) never loses its only copy of the data here.
 *
 * No-ops (zero stats) when the database is off.
 */
async function runCleanup(now: Date = new Date()): Promise<CleanupStats> {
  const db = getDb();
  if (!db) return { rateLimitsDeleted: 0, tokensDeleted: 0, eventsDeleted: 0 };

  const rateLimitCutoff = new Date(now.getTime() - ONE_DAY_MS);
  const tokenCutoff = new Date(now.getTime() - THIRTY_DAYS_MS);
  const eventCutoff = utcDay(new Date(now.getTime() - RAW_EVENT_RETENTION_DAYS * ONE_DAY_MS));

  const [rateLimitRows, tokenRows, eventRows] = await Promise.all([
    db.delete(rateLimits).where(lt(rateLimits.windowStart, rateLimitCutoff)).returning({ key: rateLimits.key }),
    db
      .delete(apiTokens)
      .where(and(sql`${apiTokens.revokedAt} is not null`, lt(apiTokens.revokedAt, tokenCutoff)))
      .returning({ id: apiTokens.id }),
    db
      .delete(downloadEvents)
      .where(
        and(
          lt(downloadEvents.day, eventCutoff),
          sql`exists (
            select 1 from download_rollups
            where download_rollups.owner = ${downloadEvents.owner}
              and download_rollups.name = ${downloadEvents.name}
              and download_rollups.day = ${downloadEvents.day}
          )`
        )
      )
      .returning({ id: downloadEvents.id }),
  ]);

  return {
    rateLimitsDeleted: rateLimitRows.length,
    tokensDeleted: tokenRows.length,
    eventsDeleted: eventRows.length,
  };
}

// GET /api/cron/cleanup — hourly (see vercel.json). See runCleanup above for
// what it prunes. Idempotent/re-runnable: every delete is a plain age/existence
// filter, so running it twice in a row just deletes nothing the second time.
export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const stats = await runCleanup();
    return Response.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[cron/cleanup]", err);
    return Response.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
