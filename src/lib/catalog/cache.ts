// Tiny in-memory TTL cache for DB-backed catalog reads (Y8).
//
// `list`/`tags`/`facets`/`featured` on the DB catalog each run one or more
// Postgres queries (see catalog/db.ts); on a warm serverless instance the
// same handful of queries (the default listing, the tag cloud, a popular
// facet combination) repeat within seconds of each other. This cache shaves
// those repeat round-trips.
//
// Deliberately NOT `unstable_cache`: that needs Next.js's data-cache tag
// plumbing (tags to invalidate, a cache handler in production) wired up for
// no real benefit here, since the counts this app tracks (downloads, stars)
// already read from their own always-fresh `package_stats` table via
// `withStats` — this cache only covers the package rows/facets themselves.
// A plain per-instance `Map` works with zero env vars, same as everything
// else in this app's zero-config deploy story, and `invalidateCatalogCache`
// gives writers (publish.ts, moderation.ts) an explicit way to bust it after
// a write rather than waiting out the TTL.
//
// Per-instance, not shared across instances — same caveat as ratelimit.ts's
// bucket map: each warm Vercel instance holds its own copy, and a redeploy
// or cold start clears it. That's fine for a cache (worst case is a few
// extra DB queries, never stale-forever data), unlike the rate limiter where
// it's a correctness compromise.

/** Default freshness window for a cached catalog read. */
export const CATALOG_CACHE_TTL_MS = 60_000;

interface Entry<T> {
  /** The resolved value, or (while a fetch is in flight) the pending promise
   *  itself — see `cached` below for why storing the promise matters. */
  value: T | Promise<T>;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

/**
 * Returns the cached value for `key` if it's still within `ttlMs` of when it
 * was stored, otherwise calls `fn`, caches the result, and returns it.
 *
 * Concurrent calls for the same key while a fetch is in flight all get the
 * same promise (the promise is cached before it settles), so a burst of
 * requests hitting a cold cache at once fans out into one query, not N. A
 * rejected fetch is evicted rather than cached, so a transient DB error
 * doesn't poison the key for the next `ttlMs`.
 */
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return Promise.resolve(hit.value as T);
  }

  const promise = fn();
  const entry: Entry<unknown> = { value: promise, expiresAt: now + ttlMs };
  store.set(key, entry);

  promise.then(
    (value) => {
      // Only overwrite if nothing else (a later call, an invalidate) has
      // already replaced or removed this entry.
      if (store.get(key) === entry) store.set(key, { value, expiresAt: entry.expiresAt });
    },
    () => {
      if (store.get(key) === entry) store.delete(key);
    }
  );

  return promise;
}

/** Drops every cached catalog read. Call after any write that changes what a
 *  cached query would return — `src/lib/publish.ts` (publishing, editing, or
 *  changing a package's status) and `src/lib/moderation.ts` (moderation
 *  actions that change status/visibility) should call this once their write
 *  commits. Clearing everything rather than tracking fine-grained
 *  dependencies is deliberate: this catalog is small enough that the next
 *  request just refills the cache, and "wrong key invalidated" is a much
 *  worse failure mode than "cache briefly empty". */
export function invalidateCatalogCache(): void {
  store.clear();
}
