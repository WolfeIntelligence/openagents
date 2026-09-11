// Catalog abstraction entry point. See SPEC.md "Architecture" and
// "Directory layout" (`src/lib/catalog/{index,seed,db}.ts`).
//
// Same `server-only` caveat as `./seed` — intentionally omitted here; see the
// note at the top of `src/lib/catalog/seed.ts`.

import {
  CATALOG_ALL_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PACKAGE_KINDS,
  RUNTIME_IDS,
  type Catalog,
  type CatalogPage,
  type CatalogQuery,
  type Package,
  type PackageKind,
  type PackageSummary,
  type RuntimeId,
} from "@/lib/types";
import { seedCatalog } from "@/lib/catalog/seed";
import { cached, CATALOG_CACHE_TTL_MS } from "@/lib/catalog/cache";
import { getStats, statsKey, ZERO_STATS } from "@/lib/stats";
import { rankByQuery, tokenize } from "@/lib/search";

let catalogPromise: Promise<Catalog> | null = null;

/**
 * Returns the active `Catalog` implementation. **Async** — callers must
 * `await getCatalog()`.
 *
 * Always falls back to the seed catalog (packages under `catalog/`, works
 * with zero env vars — this is the v0.1 deploy target per SPEC.md). When
 * `DATABASE_URL` is set AND a sibling `./db` module exists and exports
 * `createDbCatalog(seed: Catalog): Catalog`, that implementation is used
 * instead (it is expected to merge DB-backed packages with the seed catalog
 * it's handed). `./db` is loaded with a dynamic `import()` so DB/Drizzle
 * code never ends up on a code path that runs with no `DATABASE_URL`, and is
 * wrapped in try/catch so a missing or erroring db module — e.g. it hasn't
 * been implemented yet, or the database is unreachable — silently falls
 * back to the seed catalog. This function never throws.
 */
export function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = buildCatalog();
  }
  return catalogPromise;
}

async function buildCatalog(): Promise<Catalog> {
  if (!process.env.DATABASE_URL) {
    // No database means nowhere to have recorded a download or a star, so every
    // package correctly reports zero rather than a made-up number.
    return seedCatalog;
  }
  let base: Catalog = seedCatalog;
  try {
    const mod = (await import("./db")) as {
      createDbCatalog?: (seed: Catalog) => Catalog;
    };
    if (typeof mod.createDbCatalog === "function") {
      // Caching only applies to the DB catalog — the seed catalog already
      // reads from an in-memory structure built once at startup, so wrapping
      // it here would add bookkeeping for no benefit.
      base = withCatalogCache(mod.createDbCatalog(seedCatalog));
    }
  } catch {
    // "./db" doesn't exist yet, failed to import, or failed to construct —
    // fall back to the always-available seed catalog.
  }
  return withStats(base);
}

/** Stable JSON key for a `CatalogQuery` — sorted keys and `undefined` values
 *  dropped, so two calls that mean the same query (regardless of how their
 *  optional fields were populated) hit the same cache entry. */
function queryCacheKey(prefix: string, query: CatalogQuery): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(query).sort()) {
    const value = (query as Record<string, unknown>)[key];
    if (value !== undefined) sorted[key] = value;
  }
  return `${prefix}:${JSON.stringify(sorted)}`;
}

/**
 * Wraps the DB catalog's `list`/`tags`/`facets`/`featured` in the in-memory
 * TTL cache from `./cache` (Y8). `get`/`getFile`/`creator` are single-item
 * lookups (package pages, file downloads, creator pages) that don't share
 * this catalog's "list everything" cost profile and are left uncached.
 *
 * `includeHidden` queries (the owner's own pending/unlisted packages, the
 * moderation queue) bypass the cache entirely rather than being cached under
 * their own key — they're low-traffic, viewer-specific in effect, and a
 * stale hit here would show an owner a package that no longer matches its
 * real status right after they changed it.
 */
function withCatalogCache(inner: Catalog): Catalog {
  return {
    async list(query: CatalogQuery = {}): Promise<CatalogPage> {
      if (query.includeHidden) return inner.list(query);
      return cached(queryCacheKey("list", query), CATALOG_CACHE_TTL_MS, () => inner.list(query));
    },
    get: inner.get,
    getFile: inner.getFile,
    creator: inner.creator,
    async tags(): Promise<{ tag: string; count: number }[]> {
      return cached("tags", CATALOG_CACHE_TTL_MS, () => inner.tags());
    },
    facets: inner.facets
      ? (query: CatalogQuery = {}) => {
          if (query.includeHidden) return inner.facets!(query);
          return cached(queryCacheKey("facets", query), CATALOG_CACHE_TTL_MS, () =>
            inner.facets!(query)
          );
        }
      : undefined,
    async featured(limit?: number): Promise<PackageSummary[]> {
      return cached(queryCacheKey("featured", { limit }), CATALOG_CACHE_TTL_MS, () =>
        inner.featured(limit)
      );
    },
  };
}

/**
 * Wraps a catalog so every package carries its real download and star counts.
 *
 * Counts live in one `package_stats` table keyed by (owner, name), which covers
 * on-disk seed packages and database-backed ones alike, so this decorator is the
 * single place stats are attached. The underlying catalogs always report zero.
 */
function withStats(inner: Catalog): Catalog {
  async function decorate(items: PackageSummary[]): Promise<PackageSummary[]> {
    if (items.length === 0) return items;
    const map = await getStats(items.map((i) => ({ owner: i.owner, name: i.name })));
    return items.map((item) => ({
      ...item,
      // Merge, don't replace: `sort=trending` (catalog/db.ts) may have already
      // stamped a real `stats.trending` count onto this item, and a wholesale
      // replace here would silently discard it. downloads/stars/rating always
      // come from this authoritative source either way.
      stats: { ...item.stats, ...(map.get(statsKey(item.owner, item.name)) ?? ZERO_STATS) },
    }));
  }

  return {
    async list(query: CatalogQuery = {}): Promise<CatalogPage> {
      // Sorting by a real count has to happen after the counts are attached, so
      // for those two sorts fetch the whole filtered set, decorate, then page.
      // The catalog is small enough that this is one extra query, not a scan.
      //
      // `limit` is an explicit ceiling rather than `undefined`: the seed catalog
      // reads an absent limit as its default page size, which would drop every
      // package past that page before the re-sort ever saw it.
      if (query.sort === "downloads" || query.sort === "stars") {
        const { items, total, correctedQuery } = await inner.list({
          ...query,
          limit: CATALOG_ALL_LIMIT,
          offset: 0,
        });
        const decorated = await decorate(items);
        const key = query.sort;
        // An explicit sort=downloads/stars always wins on the primary key, but
        // when a search query is also present, break ties in relevance order
        // (exact name match, then name/title contains, then the rest) rather
        // than arbitrarily by date — same tiering as the unfiltered case, via
        // the one shared helper in ./search.
        const terms = query.q ? tokenize(query.q) : [];
        const relevanceRank = new Map(
          (terms.length > 0 ? rankByQuery(decorated, terms) : decorated).map((item, i) => [
            item.id,
            i,
          ])
        );
        decorated.sort(
          (a, b) =>
            b.stats[key] - a.stats[key] ||
            relevanceRank.get(a.id)! - relevanceRank.get(b.id)! ||
            b.updatedAt.localeCompare(a.updatedAt) ||
            a.name.localeCompare(b.name)
        );
        // `query.limit` is guaranteed by now: `parseCatalogQuery` defaults it for
        // request-driven queries, and internal callers pass CATALOG_ALL_LIMIT
        // explicitly for "everything" fetches. No per-layer default here.
        const offset = query.offset ?? 0;
        const limit = query.limit!;
        return { items: decorated.slice(offset, offset + limit), total, correctedQuery };
      }

      const page = await inner.list(query);
      return { ...page, items: await decorate(page.items) };
    },

    async get(owner: string, name: string): Promise<Package | null> {
      // Independent lookups — run them concurrently rather than waiting on the
      // package fetch before starting the stats query.
      const [pkg, map] = await Promise.all([
        inner.get(owner, name),
        getStats([{ owner, name }]),
      ]);
      if (!pkg) return null;
      return { ...pkg, stats: map.get(statsKey(owner, name)) ?? ZERO_STATS };
    },

    getFile: inner.getFile,
    creator: inner.creator,
    tags: inner.tags,
    // Facet counts don't need stats decoration (they're counts, not package
    // cards) — pass straight through. Stays `undefined` if `inner` doesn't
    // implement it, which is exactly what the optional `Catalog.facets?`
    // contract expects.
    facets: inner.facets,

    async featured(limit?: number): Promise<PackageSummary[]> {
      return decorate(await inner.featured(limit));
    },
  };
}

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function readParam(params: SearchParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) {
    return params.get(key) ?? undefined;
  }
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

// "trending" (G-S4) is resolved entirely inside each catalog's own `list()`
// (see `sortByTrending` in `catalog/db.ts`) rather than here in `withStats`,
// because trending is a 7-day download_events count, not the lifetime
// downloads/stars this decorator attaches — it needs no post-decoration
// re-sort the way "downloads"/"stars" do below.
const SORTS = ["downloads", "stars", "updated", "name", "trending"] as const;

/** Parses/validates raw query params (from a URL or a Next.js `searchParams`) into a `CatalogQuery`. Unknown/invalid enum values are dropped rather than throwing. */
export function parseCatalogQuery(searchParams: SearchParamsLike): CatalogQuery {
  const query: CatalogQuery = {};

  const q = readParam(searchParams, "q");
  if (q) query.q = q;

  const kind = readParam(searchParams, "kind");
  if (kind && (PACKAGE_KINDS as readonly string[]).includes(kind)) {
    query.kind = kind as PackageKind;
  }

  const runtime = readParam(searchParams, "runtime");
  if (runtime && (RUNTIME_IDS as readonly string[]).includes(runtime)) {
    query.runtime = runtime as RuntimeId;
  }

  const price = readParam(searchParams, "price");
  if (price === "free" || price === "paid") query.price = price;

  const tag = readParam(searchParams, "tag");
  if (tag) query.tag = tag;

  const owner = readParam(searchParams, "owner");
  if (owner) query.owner = owner;

  const sort = readParam(searchParams, "sort");
  if (sort && (SORTS as readonly string[]).includes(sort as (typeof SORTS)[number])) {
    query.sort = sort as CatalogQuery["sort"];
  }

  // `limit` always ends up set — missing or bogus values fall back to
  // DEFAULT_PAGE_SIZE, everything else is clamped to [1, MAX_PAGE_SIZE] — so
  // every catalog layer can trust `query.limit` rather than inventing its own
  // default (see DEFAULT_PAGE_SIZE/MAX_PAGE_SIZE in ./types).
  const limit = readParam(searchParams, "limit");
  const parsedLimit = limit !== undefined ? Number(limit) : NaN;
  const wholeLimit = Number.isFinite(parsedLimit) ? Math.floor(parsedLimit) : DEFAULT_PAGE_SIZE;
  query.limit = Math.min(Math.max(wholeLimit, 1), MAX_PAGE_SIZE);

  const offset = readParam(searchParams, "offset");
  if (offset !== undefined) {
    const n = Number(offset);
    if (Number.isFinite(n) && n >= 0) query.offset = Math.floor(n);
  }

  // `?facets=1` (G-S3) — anything else (missing, "0", "false", garbage) is "no".
  if (readParam(searchParams, "facets") === "1") query.facets = true;

  return query;
}
