// In-memory sliding-window rate limiter.
//
// IMPORTANT: this is per-serverless-instance, best-effort limiting, not a hard
// guarantee. On Vercel (and most serverless hosts) each instance holds its own
// copy of `buckets`, consecutive requests from the same client can land on
// different instances, and every cold start/redeploy resets all counts to
// zero. That means a determined client can exceed the nominal limit by
// spreading requests across instances or waiting out a redeploy. What this
// *does* reliably stop is casual scripted abuse and accidental hot loops from
// a single warm instance — good enough for B10's download-counter inflation
// and for capping star/file-read spam, not a substitute for a shared store
// (Upstash/Redis) if this ever needs to be exact across instances.
//
// No Next.js imports here on purpose — this module is pure logic so it can be
// unit-tested with plain `node --test` (see `./__tests__/ratelimit.test.ts`).

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
