// In-memory sliding-window rate limiter, plus a durable fixed-window limiter
// backed by the `rate_limits` table (see `rateLimitDurable` below) for routes
// where per-instance limiting isn't good enough (Y4).
//
// IMPORTANT: `rateLimit` (the in-memory one) is per-serverless-instance,
// best-effort limiting, not a hard guarantee. On Vercel (and most serverless
// hosts) each instance holds its own copy of `buckets`, consecutive requests
// from the same client can land on different instances, and every cold
// start/redeploy resets all counts to zero. That means a determined client
// can exceed the nominal limit by spreading requests across instances or
// waiting out a redeploy. What this *does* reliably stop is casual scripted
// abuse and accidental hot loops from a single warm instance. It stays here,
// unchanged, because it's still what `rateLimitDurable` falls back to when the
// database is off or unreachable, and other code may still call it directly.
//
// No Next.js imports here on purpose — this module (aside from the small
// Postgres/drizzle dependency `rateLimitDurable` needs) is otherwise pure
// logic so it can be unit-tested with plain `node --test` (see
// `./__tests__/ratelimit.test.ts`). `@/lib/db/client` and `@/lib/db/schema`
// are themselves zero-env-safe (see their own comments) and already imported
// from test-covered lib modules like `tokens.ts`, so this doesn't change that.

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

export interface RateLimitOptions {
  /** Max calls allowed per `windowMs` for a given key. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Calls this key has left in the current window (0 when `!ok`). */
  remaining: number;
  /** Seconds until the oldest call in the window expires (0 when `ok`). Use
   *  this to set a `Retry-After` header on the 429. */
  retryAfterSeconds: number;
}

interface Bucket {
  /** Timestamps (ms) of calls still inside the current window, oldest first. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/**
 * Sliding-window rate limit: `key` may make at most `options.limit` calls per
 * `options.windowMs`. Call once per request and act on `.ok`; this function
 * itself never throws or blocks.
 */
export function rateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const { limit, windowMs } = options;
  const now = Date.now();
  const windowStart = now - windowMs;

  let bucket = buckets.get(key);
  const hits = bucket ? bucket.hits.filter((t) => t > windowStart) : [];

  if (hits.length >= limit) {
    // Bucket may have shrunk from the filter above even though we're still
    // over the limit — write the trimmed version back either way.
    if (bucket) bucket.hits = hits;
    else buckets.set(key, (bucket = { hits }));
    const oldest = hits[0];
    const retryAfterMs = oldest + windowMs - now;
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  hits.push(now);
  if (bucket) {
    bucket.hits = hits;
  } else {
    buckets.set(key, { hits });
  }

  return { ok: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

/**
 * Best-effort client IP for rate-limit keying: the first hop of
 * `x-forwarded-for` (the client closest to the origin among any proxies),
 * falling back to `x-real-ip`, then the literal string `"unknown"` — which
 * pools every such request into one shared bucket. That under-limits requests
 * we can't otherwise distinguish rather than over-limiting real ones, which
 * matches the "best effort" nature of this whole module.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  return "unknown";
}

// --- Durable (cross-instance) rate limiting -------------------------------
//
// `rateLimit` above resets on every cold start and doesn't share state across
// serverless instances, which is fine for casual abuse but not for routes an
// attacker actually has an incentive to hammer (downloads that inflate a
// counter, publish, checkout, token minting). `rateLimitDurable` gives those
// routes a real cross-instance limit using the `rate_limits(key, count,
// windowStart)` table, at the cost of one extra DB round trip per call.

/**
 * Pure fixed-window arithmetic shared by `rateLimitDurable`: turns the
 * post-upsert `count`/`windowStart` of a `rate_limits` row into the same
 * `{ ok, remaining, retryAfterSeconds }` shape `rateLimit` returns. Kept as a
 * standalone export (rather than inlined into `rateLimitDurable`) so the
 * window math can be unit-tested without a database — see
 * `./__tests__/ratelimit.test.ts`.
 *
 * `now` defaults to `Date.now()` and is only a parameter so tests can pin it.
 */
export function fixedWindowResult(
  count: number,
  windowStart: Date,
  options: RateLimitOptions,
  now: number = Date.now()
): RateLimitResult {
  const { limit, windowMs } = options;
  const ok = count <= limit;
  const remaining = Math.max(0, limit - count);
  if (ok) return { ok: true, remaining, retryAfterSeconds: 0 };

  const retryAfterMs = windowStart.getTime() + windowMs - now;
  return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
}

// Logged once (not once per request) so a DB outage doesn't spam the log —
// every fallback call after the first stays silent.
let loggedDurableFallback = false;

// Bumped on every `rateLimitDurable` call; used to run cleanup only every
// ~200th call rather than on a timer (this module has no background tasks).
let durableCallCount = 0;

/**
 * Durable counterpart to `rateLimit`, backed by the `rate_limits` table: one
 * atomic `INSERT … ON CONFLICT … DO UPDATE` implements a fixed window (the
 * count resets to 1 the moment `windowStart` is older than `windowMs`,
 * otherwise it increments), so concurrent requests from the same key across
 * different serverless instances can't race past the limit the way two
 * read-then-write statements could.
 *
 * Falls back to the in-memory `rateLimit` — silently when the database is
 * simply off (`DATABASE_URL` unset, the normal zero-env case), logged once
 * when the query itself throws (schema not pushed yet, DB unreachable, etc.)
 * — so a database hiccup degrades this to per-instance limiting rather than
 * failing the request or, worse, failing open with no limit at all.
 */
export async function rateLimitDurable(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const db = getDb();
  if (!db) return rateLimit(key, options);

  try {
    const { windowMs } = options;
    const result = await db.execute<{ count: number; windowStart: string }>(sql`
      INSERT INTO rate_limits (key, count, "windowStart")
      VALUES (${key}, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limits."windowStart" < now() - interval '1 millisecond' * ${windowMs}
          THEN 1
          ELSE rate_limits.count + 1
        END,
        "windowStart" = CASE
          WHEN rate_limits."windowStart" < now() - interval '1 millisecond' * ${windowMs}
          THEN now()
          ELSE rate_limits."windowStart"
        END
      RETURNING count, "windowStart"
    `);

    const row = result.rows[0];
    if (!row) {
      // Should be unreachable (RETURNING always yields the upserted row), but
      // don't let a driver quirk turn into a crash — degrade gracefully.
      return rateLimit(key, options);
    }

    // Opportunistic cleanup: keep the table from growing forever without a
    // cron job. Fire-and-forget on roughly 1 in 200 calls; never let cleanup
    // failure affect the rate-limit decision that's actually being returned.
    durableCallCount += 1;
    if (durableCallCount % 200 === 0) {
      db.execute(sql`DELETE FROM rate_limits WHERE "windowStart" < now() - interval '1 day'`).catch(
        () => {}
      );
    }

    return fixedWindowResult(Number(row.count), new Date(row.windowStart), options);
  } catch (err) {
    if (!loggedDurableFallback) {
      loggedDurableFallback = true;
      console.error(
        "[ratelimit] durable rate limit query failed, falling back to in-memory limiting:",
        err
      );
    }
    return rateLimit(key, options);
  }
}

/**
 * Per-route rate limit budgets, kept in one place so this table is the single
 * source of truth callers and docs can cite instead of duplicating numbers in
 * comments. Every route below keys `rateLimitDurable`/`withRateLimit` off of
 * IP, user id, or both depending on what identity is available and how
 * spoofable it is for that route — see each route file for the exact key.
 */
export const RATE_LIMITS = {
  /** GET .../download and .../versions/:version/download — 60/min/IP. Shared
   *  budget between the two routes (same key prefix) since a pinned-version
   *  download is just another view of the same download. */
  download: { limit: 60, windowMs: 60_000 },
  /** POST .../star — 30/min, keyed by user id when signed in, else IP. */
  star: { limit: 30, windowMs: 60_000 },
  /** POST .../report from an anonymous caller — 3/hour/IP. Tighter than the
   *  signed-in budget because an IP is coarser and easier to spoof/rotate
   *  than an authenticated account. */
  reportAnonymous: { limit: 3, windowMs: 60 * 60_000 },
  /** POST .../report from a signed-in caller — 10/hour/user. */
  reportSignedIn: { limit: 10, windowMs: 60 * 60_000 },
  /** POST /api/v1/tokens — 10/min/user. */
  tokensCreate: { limit: 10, windowMs: 60_000 },
  /** POST /api/v1/publish — 10/min/user. */
  publish: { limit: 10, windowMs: 60_000 },
  /** POST /api/v1/publish/import — 10/min/user. */
  publishImport: { limit: 10, windowMs: 60_000 },
  /** POST /api/checkout — 10/min/user. */
  checkout: { limit: 10, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitOptions>;

// Duplicated (rather than imported from `@/lib/api`) so this file keeps its
// "importable under plain Node, no framework surface" property — `@/lib/api`
// pulls in `next/server`'s `NextResponse` at module scope, which this module
// has no other reason to depend on.
const RATE_LIMIT_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  // Z5: X-RateLimit-* joins the list below now that `withRateLimit` sets them
  // on every 429 — otherwise a cross-origin caller's JS couldn't read them
  // (browsers hide every response header from cross-origin JS unless it's
  // explicitly exposed).
  "Access-Control-Expose-Headers":
    "Content-Disposition, Retry-After, ETag, X-Checksum-Sha256, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
};

export interface WithRateLimitOptions extends RateLimitOptions {
  /** Overrides the default `${name}:${clientIp(request)}` key. Routes that
   *  limit per-user (or per-user-else-IP) pass their own fully-formed key
   *  here instead. */
  key?: string;
  /** Message for the 429 body. Defaults to a generic "slow down". */
  message?: string;
}

/**
 * `X-RateLimit-*` headers for a `RateLimitResult`, so a caller can see its
 * budget without parsing the 429 body. `X-RateLimit-Reset` is a Unix timestamp
 * (seconds) computed from `retryAfterSeconds` — exact on a blocked (`!ok`)
 * result, since that's exactly how `retryAfterSeconds` itself is derived, but
 * only ever "now" on an allowed one (`retryAfterSeconds` is 0 there), because
 * `RateLimitResult` doesn't carry the window's actual start. Fine for
 * `withRateLimit`'s 429, where this is always exact; a caller that also wants
 * these on a 200 should treat the reset value as meaningless in that case.
 */
export function rateLimitHeaders(result: RateLimitResult, options: RateLimitOptions): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(options.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + result.retryAfterSeconds),
  };
}

/**
 * Route-handler-friendly wrapper around `rateLimitDurable`: call it at the top
 * of a route, and `return` its result if non-null.
 *
 *   const limited = await withRateLimit(request, "download", RATE_LIMITS.download);
 *   if (limited) return limited;
 *
 * `name` doubles as a human-readable bucket label and, when `options.key` is
 * omitted, the key prefix (`` `${name}:${clientIp(request)}` ``, matching what
 * every route in this codebase already keyed its in-memory limiter with).
 */
export async function withRateLimit(
  request: Request,
  name: string,
  options: WithRateLimitOptions
): Promise<Response | null> {
  const { key, message, ...limitOptions } = options;
  const rateLimitKey = key ?? `${name}:${clientIp(request)}`;

  const result = await rateLimitDurable(rateLimitKey, limitOptions);
  if (result.ok) return null;

  return new Response(JSON.stringify({ error: message ?? "too many requests, slow down" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(result.retryAfterSeconds),
      ...rateLimitHeaders(result, limitOptions),
      ...RATE_LIMIT_CORS_HEADERS,
    },
  });
}
