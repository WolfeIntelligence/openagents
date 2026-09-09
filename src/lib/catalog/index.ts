// Catalog abstraction entry point. See SPEC.md "Architecture" and
// "Directory layout" (`src/lib/catalog/{index,seed,db}.ts`).
//
// Same `server-only` caveat as `./seed` — intentionally omitted here; see the
// note at the top of `src/lib/catalog/seed.ts`.

import {
  PACKAGE_KINDS,
  RUNTIME_IDS,
  type Catalog,
  type CatalogQuery,
  type PackageKind,
  type RuntimeId,
} from "@/lib/types";
import { seedCatalog } from "@/lib/catalog/seed";

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
    return seedCatalog;
  }
  try {
    const mod = (await import("./db")) as {
      createDbCatalog?: (seed: Catalog) => Catalog;
    };
    if (typeof mod.createDbCatalog === "function") {
      return mod.createDbCatalog(seedCatalog);
    }
  } catch {
    // "./db" doesn't exist yet, failed to import, or failed to construct —
    // fall back to the always-available seed catalog.
  }
  return seedCatalog;
}

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function readParam(params: SearchParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) {
    return params.get(key) ?? undefined;
  }
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

const SORTS = ["downloads", "stars", "updated", "name"] as const;

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

  const limit = readParam(searchParams, "limit");
  if (limit !== undefined) {
    const n = Number(limit);
    if (Number.isFinite(n) && n > 0) query.limit = Math.floor(n);
  }

  const offset = readParam(searchParams, "offset");
  if (offset !== undefined) {
    const n = Number(offset);
    if (Number.isFinite(n) && n >= 0) query.offset = Math.floor(n);
  }

  return query;
}
