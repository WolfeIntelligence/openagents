// DB-backed Catalog implementation. Queries Postgres via Drizzle and merges results
// with the seed (on-disk) catalog: seed items are the base set, DB items win on id
// conflicts, and combined DB+seed packages/tags feed list/featured/tags queries.
//
// createDbCatalog() is only meant to be invoked by src/lib/catalog/index.ts when
// DATABASE_URL is set, but every exported function here degrades gracefully (falls
// back to the seed catalog, or is a no-op) if getDb() returns null.

import { and, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packageFiles, packages, packageVersions, users } from "@/lib/db/schema";
import { escapeLike, rankByQuery, tokenize } from "@/lib/search";
import { CATALOG_ALL_LIMIT } from "@/lib/types";
import type {
  Catalog,
  CatalogPage,
  CatalogQuery,
  Creator,
  Manifest,
  Package,
  PackageFile,
  PackageKind,
  PackageStatus,
  PackageSummary,
  PricingModel,
  RuntimeId,
} from "@/lib/types";

type Db = NonNullable<ReturnType<typeof getDb>>;
type PackageRow = typeof packages.$inferSelect;

/** Runs a DB-dependent promise, logging once and returning `fallback` instead
 *  of rejecting if it throws — an unreachable Neon instance or a missing table
 *  should degrade to the seed catalog's contribution, never 500 the page. */
function safe<T>(promise: Promise<T>, label: string, fallback: T): Promise<T> {
  return promise.catch((err: unknown) => {
    console.error(`[catalog/db] ${label} failed, falling back to seed:`, err);
    return fallback;
  });
}

function rowToSummary(row: PackageRow): PackageSummary {
  return {
    id: `${row.owner}/${row.name}`,
    owner: row.owner,
    name: row.name,
    title: row.title,
    summary: row.summary,
    kind: row.kind as PackageKind,
    tags: row.tags,
    runtimes: row.runtimes as RuntimeId[],
    pricing: {
      model: row.pricingModel as PricingModel,
      amountCents: row.amountCents,
      currency: row.currency,
    },
    version: row.latestVersion,
    license: row.license,
    // Zero here is a placeholder the `withStats` decorator in ./index replaces
    // with the real counts; this layer never stores its own copy. See ./index.
    stats: { downloads: 0, stars: 0 },
    featured: row.featured,
    status: row.status as PackageStatus,
    deprecation:
      row.status === "deprecated"
        ? {
            message: row.deprecationMessage ?? undefined,
            replacementId: row.replacementId ?? undefined,
          }
        : undefined,
    source: "db",
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function rowToPackage(db: Db, row: PackageRow): Promise<Package> {
  const versionRows = await db
    .select()
    .from(packageVersions)
    .where(eq(packageVersions.packageId, row.id));

  const latest =
    versionRows.find((v) => v.version === row.latestVersion) ??
    versionRows[versionRows.length - 1];

  const fileRows = latest
    ? await db
        .select({ path: packageFiles.path, size: packageFiles.size })
        .from(packageFiles)
        .where(eq(packageFiles.versionId, latest.id))
    : [];

  const fallbackManifest: Manifest = {
    schema: 1,
    name: row.name,
    owner: row.owner,
    version: row.latestVersion,
    kind: row.kind as PackageKind,
    title: row.title,
    summary: row.summary,
    license: row.license,
    tags: row.tags,
    runtimes: row.runtimes as RuntimeId[],
    pricing: {
      model: row.pricingModel as PricingModel,
      amountCents: row.amountCents,
      currency: row.currency,
    },
    entry: row.entry,
    files: fileRows.map((f) => f.path),
    inputs: [],
    requires: [],
  };

  const files: PackageFile[] = fileRows.map((f) => ({ path: f.path, size: f.size }));

  return {
    id: `${row.owner}/${row.name}`,
    owner: row.owner,
    name: row.name,
    manifest: (latest?.manifest as Manifest | undefined) ?? fallbackManifest,
    readme: latest?.readme ?? "",
    files,
    versions: versionRows
      .slice()
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .map((v) => ({
        version: v.version,
        publishedAt: v.publishedAt.toISOString(),
        changelog: v.changelog ?? undefined,
      })),
    stats: { downloads: 0, stars: 0 }, // filled in by `withStats` — see ./index
    featured: row.featured,
    status: row.status as PackageStatus,
    deprecation:
      row.status === "deprecated"
        ? {
            message: row.deprecationMessage ?? undefined,
            replacementId: row.replacementId ?? undefined,
          }
        : undefined,
    source: "db",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Builds the merged `WHERE` clause for a catalog query. Each search term is
 *  ANDed in as its own OR-across-fields condition (title/summary/name/owner/
 *  tags), so a multi-word `q` like "code review" requires every term to match
 *  *something*, matching the in-memory semantics in `matchesTerms` (seed.ts).
 *  Every LIKE pattern is built from `escapeLike` so a literal `%`/`_` in `q`
 *  can't turn into a wildcard — see search.ts's doc comment on the default
 *  Postgres escape character. */
function buildWhere(query: CatalogQuery, terms: string[]) {
  const conditions = [];
  // Pending and unlisted packages never appear in public listings or search; the
  // owner's own view and the admin queue pass `includeHidden` to see them.
  if (!query.includeHidden) {
    conditions.push(inArray(packages.status, ["live", "deprecated"]));
  }
  if (query.kind) conditions.push(eq(packages.kind, query.kind));
  if (query.runtime) {
    conditions.push(sql`${packages.runtimes} @> ${JSON.stringify([query.runtime])}::jsonb`);
  }
  if (query.tag) {
    conditions.push(sql`${packages.tags} @> ${JSON.stringify([query.tag])}::jsonb`);
  }
  if (query.owner) conditions.push(eq(packages.owner, query.owner));
  if (query.price === "free") conditions.push(eq(packages.pricingModel, "free"));
  if (query.price === "paid") conditions.push(ne(packages.pricingModel, "free"));
  for (const term of terms) {
    const like = `%${escapeLike(term)}%`;
    conditions.push(
      or(
        ilike(packages.title, like),
        ilike(packages.summary, like),
        ilike(packages.name, like),
        ilike(packages.owner, like),
        // A hyphenated tag ("code-review") also matches the term "review" —
        // same hyphen-as-separator rule `matchesTerms` applies in memory.
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${packages.tags}) t
          WHERE t ILIKE ${like} OR REPLACE(t, '-', ' ') ILIKE ${like}
        )`
      )
    );
  }
  return conditions.length ? and(...conditions) : undefined;
}

async function queryDbSummaries(
  db: Db,
  query: CatalogQuery,
  terms: string[]
): Promise<PackageSummary[]> {
  const where = buildWhere(query, terms);
  const rows = where
    ? await db.select().from(packages).where(where)
    : await db.select().from(packages);
  return rows.map(rowToSummary);
}

function mergeSummaries(seedItems: PackageSummary[], dbItems: PackageSummary[]): PackageSummary[] {
  const map = new Map<string, PackageSummary>();
  for (const item of seedItems) map.set(item.id, item);
  for (const item of dbItems) map.set(item.id, item); // DB wins on id conflicts
  return Array.from(map.values());
}

/** Orders a merged page. "downloads" and "stars" are deliberately not handled
 *  here: this layer reports zero for both, so `withStats` in ./index re-sorts by
 *  the real counts once it has attached them. Ordering by recency in the meantime
 *  keeps the pre-sort stable rather than arbitrary. */
function sortSummaries(items: PackageSummary[], sort: CatalogQuery["sort"]): PackageSummary[] {
  const arr = [...items];
  if (sort === "name") {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    arr.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
        a.name.localeCompare(b.name)
    );
  }
  return arr;
}

export function createDbCatalog(seed: Catalog): Catalog {
  return {
    async list(query: CatalogQuery = {}): Promise<CatalogPage> {
      const db = getDb();
      // Explicit ceiling, not `undefined` — see CATALOG_ALL_LIMIT. Merging needs
      // every matching seed package, then this layer pages the merged result.
      const seedQuery: CatalogQuery = {
        ...query,
        limit: CATALOG_ALL_LIMIT,
        offset: 0,
      };
      const terms = query.q ? tokenize(query.q) : [];
      const [seedPage, dbSummaries] = await Promise.all([
        seed.list(seedQuery),
        db ? safe(queryDbSummaries(db, query, terms), "list query", []) : Promise.resolve([]),
      ]);
      const combined = mergeSummaries(seedPage.items, dbSummaries);
      // No explicit sort and a search query: rank by relevance, same tiering as
      // the seed catalog, via the one shared helper in ./search. Otherwise keep
      // the existing name/recency ordering.
      const merged =
        terms.length > 0 && !query.sort ? rankByQuery(combined, terms) : sortSummaries(combined, query.sort);
      const offset = query.offset ?? 0;
      // `query.limit` is always set by now — `parseCatalogQuery` defaults it, and
      // internal callers pass CATALOG_ALL_LIMIT explicitly. No default here.
      const limit = query.limit!;
      return { items: merged.slice(offset, offset + limit), total: merged.length };
    },

    async get(owner: string, name: string): Promise<Package | null> {
      const db = getDb();
      if (db) {
        try {
          const [row] = await db
            .select()
            .from(packages)
            .where(and(eq(packages.owner, owner), eq(packages.name, name)))
            .limit(1);
          if (row) return await rowToPackage(db, row);
        } catch (err) {
          console.error(`[catalog/db] get(${owner}/${name}) failed, falling back to seed:`, err);
        }
      }
      return seed.get(owner, name);
    },

    async getFile(owner: string, name: string, path: string): Promise<PackageFile | null> {
      const db = getDb();
      if (db) {
        try {
          const [row] = await db
            .select()
            .from(packages)
            .where(and(eq(packages.owner, owner), eq(packages.name, name)))
            .limit(1);
          if (row) {
            const [versionRow] = await db
              .select()
              .from(packageVersions)
              .where(
                and(
                  eq(packageVersions.packageId, row.id),
                  eq(packageVersions.version, row.latestVersion)
                )
              )
              .limit(1);
            if (versionRow) {
              const [fileRow] = await db
                .select()
                .from(packageFiles)
                .where(
                  and(eq(packageFiles.versionId, versionRow.id), eq(packageFiles.path, path))
                )
                .limit(1);
              if (fileRow) {
                return { path: fileRow.path, size: fileRow.size, content: fileRow.content };
              }
            }
            // Package exists in DB but file wasn't found there — don't fall through to seed.
            return null;
          }
        } catch (err) {
          console.error(
            `[catalog/db] getFile(${owner}/${name}, ${path}) failed, falling back to seed:`,
            err
          );
        }
      }
      return seed.getFile(owner, name, path);
    },

    async creator(handle: string): Promise<Creator | null> {
      const db = getDb();
      const [seedCreator, dbUser, dbPackageCount] = await Promise.all([
        seed.creator(handle),
        db
          ? safe(
              db.select().from(users).where(eq(users.handle, handle)).limit(1).then((r) => r[0]),
              `creator(${handle}) user lookup`,
              undefined
            )
          : Promise.resolve(undefined),
        db
          ? safe(
              db
                .select({ id: packages.id })
                .from(packages)
                .where(eq(packages.owner, handle))
                .then((r) => r.length),
              `creator(${handle}) package count`,
              0
            )
          : Promise.resolve(0),
      ]);

      if (!seedCreator && !dbUser) return null;

      return {
        handle,
        displayName: dbUser?.name ?? seedCreator?.displayName ?? handle,
        bio: dbUser?.bio ?? seedCreator?.bio,
        avatarUrl: dbUser?.image ?? seedCreator?.avatarUrl,
        url: seedCreator?.url,
        packageCount: (seedCreator?.packageCount ?? 0) + dbPackageCount,
      };
    },

    async featured(limit = 6): Promise<PackageSummary[]> {
      const db = getDb();
      const [seedItems, dbRows] = await Promise.all([
        seed.featured(limit * 2),
        db
          ? safe(
              db.select().from(packages).where(eq(packages.featured, true)),
              "featured query",
              []
            )
          : Promise.resolve([]),
      ]);
      const merged = sortSummaries(mergeSummaries(seedItems, dbRows.map(rowToSummary)), "updated");
      return merged.slice(0, limit);
    },

    async tags(): Promise<{ tag: string; count: number }[]> {
      const db = getDb();
      const [seedTags, dbRows] = await Promise.all([
        seed.tags(),
        db
          ? safe(db.select({ tags: packages.tags }).from(packages), "tags query", [])
          : Promise.resolve([]),
      ]);
      const counts = new Map<string, number>();
      for (const { tag, count } of seedTags) counts.set(tag, (counts.get(tag) ?? 0) + count);
      for (const row of dbRows) {
        for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
    },
  };
}
