// DB-backed Catalog implementation. Queries Postgres via Drizzle and merges results
// with the seed (on-disk) catalog: seed items are the base set, DB items win on id
// conflicts, and combined DB+seed packages/tags feed list/featured/tags queries.
//
// createDbCatalog() is only meant to be invoked by src/lib/catalog/index.ts when
// DATABASE_URL is set, but every exported function here degrades gracefully (falls
// back to the seed catalog, or is a no-op) if getDb() returns null.

import { and, eq, gte, ilike, inArray, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  downloadEvents,
  downloadRollups,
  organizations,
  packageFiles,
  packages,
  packagesFtsExpression,
  packageVersions,
  users,
} from "@/lib/db/schema";
import { utcDay } from "@/lib/analytics";
import {
  buildCorrectedQuery,
  buildVocabulary,
  escapeLike,
  matchesTerms,
  rankByQuery,
  tokenize,
} from "@/lib/search";
import { CATALOG_ALL_LIMIT, PACKAGE_KINDS, RUNTIME_IDS } from "@/lib/types";
import type {
  Catalog,
  CatalogPage,
  CatalogQuery,
  Creator,
  FacetCounts,
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
        .select({
          path: packageFiles.path,
          size: packageFiles.size,
          encoding: packageFiles.encoding,
          mode: packageFiles.mode,
        })
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

  const files: PackageFile[] = fileRows.map((f) => ({
    path: f.path,
    size: f.size,
    encoding: f.encoding as "utf8" | "base64",
    mode: f.mode ?? undefined,
  }));

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

type FacetDimension = "kind" | "runtime" | "price" | "tag" | "owner";

/**
 * Full-text match condition for `q` (G-S1): a Postgres `tsvector` over
 * title/summary/name/owner/tags matched against `websearch_to_tsquery`, which
 * understands natural multi-word queries (AND/OR/quoted phrases) and stems
 * words ("reviewing" matches "review") — something the ILIKE terms below
 * can't do. OR'd with the ILIKE terms rather than replacing them so a
 * mid-word/partial match (e.g. "revie") still hits, since `websearch_to_
 * tsquery` only matches whole lexemes.
 *
 * G-O5: the `to_tsvector(...)` side is built by `packagesFtsExpression`,
 * shared verbatim with the `packages_fts_idx` GIN index in db/schema.ts, so
 * the planner can actually use that index — Postgres only matches a
 * functional index when the query expression is byte-for-byte identical to
 * the indexed one. Never reconstruct this expression by hand here; always
 * call the shared function.
 *
 * Final cross-source ordering (seed + DB merged) is unified by the shared JS
 * scorer in search.ts (`rankByQuery`/`scoreDocument`) once rows are merged —
 * see `list()` below — so `ts_rank` isn't threaded through as a sort key
 * here; this condition only widens *which* rows match.
 */
function tsMatchCondition(q: string) {
  return sql`${packagesFtsExpression(packages)} @@ websearch_to_tsquery('english', ${q})`;
}

/** Builds the merged `WHERE` clause for a catalog query. Each search term is
 *  ANDed in as its own OR-across-fields condition (title/summary/name/owner/
 *  tags), so a multi-word `q` like "code review" requires every term to match
 *  *something*, matching the in-memory semantics in `matchesTerms` (seed.ts).
 *  Every LIKE pattern is built from `escapeLike` so a literal `%`/`_` in `q`
 *  can't turn into a wildcard — see search.ts's doc comment on the default
 *  Postgres escape character.
 *
 *  `skip` omits one filter dimension's own condition — used by `facets()` so
 *  a dimension's count is computed as if its own filter weren't applied (see
 *  the `FacetCounts` doc comment in types.ts), while every other filter
 *  (including `q`) still narrows the count. */
function buildWhere(query: CatalogQuery, terms: string[], skip?: FacetDimension) {
  const conditions = [];
  // Pending and unlisted packages never appear in public listings or search; the
  // owner's own view and the admin queue pass `includeHidden` to see them.
  if (!query.includeHidden) {
    conditions.push(inArray(packages.status, ["live", "deprecated"]));
  }
  if (query.kind && skip !== "kind") conditions.push(eq(packages.kind, query.kind));
  if (query.runtime && skip !== "runtime") {
    conditions.push(sql`${packages.runtimes} @> ${JSON.stringify([query.runtime])}::jsonb`);
  }
  if (query.tag && skip !== "tag") {
    conditions.push(sql`${packages.tags} @> ${JSON.stringify([query.tag])}::jsonb`);
  }
  if (query.owner && skip !== "owner") conditions.push(eq(packages.owner, query.owner));
  if (skip !== "price") {
    if (query.price === "free") conditions.push(eq(packages.pricingModel, "free"));
    if (query.price === "paid") conditions.push(ne(packages.pricingModel, "free"));
  }
  if (terms.length > 0 && query.q) {
    const ilikeTerms = terms.map((term) => {
      const like = `%${escapeLike(term)}%`;
      return or(
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
      );
    });
    conditions.push(or(and(...ilikeTerms), tsMatchCondition(query.q)));
  }
  return conditions.length ? and(...conditions) : undefined;
}

async function queryDbSummaries(
  db: Db,
  query: CatalogQuery,
  terms: string[],
  skip?: FacetDimension
): Promise<PackageSummary[]> {
  const where = buildWhere(query, terms, skip);
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
 *  keeps the pre-sort stable rather than arbitrary. "trending" is handled by
 *  `sortByTrending` before this ever runs (see `list()`). */
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

/**
 * Download counts per package over the trailing 7 days, keyed by "owner/name"
 * (G-S4, updated for Z5).
 *
 * Reads the pre-aggregated `download_rollups.count` (summed per package across
 * days before today) plus a raw `download_events` count for today, rather than
 * scanning every raw event in the window — the whole point of the rollup table.
 * That trades one bit of precision for it: a rollup day's count is already
 * deduped per-client-per-day (same as the old `count(distinct clientHash)`
 * here), but summing several such days counts a repeat visitor once per day
 * they installed rather than once across the whole 7-day window. Invisible at
 * the ranking granularity this powers.
 *
 * Falls back to the original whole-window `count(distinct clientHash)` scan
 * when there are no rollup rows in range at all — an empty/not-yet-populated
 * rollup table (fresh deployment, or the nightly cron hasn't run yet) must
 * never look like nothing is trending.
 */
async function queryTrendingCounts(
  db: Db,
  refs: { owner: string; name: string }[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (refs.length === 0) return out;
  const today = utcDay();
  const since = utcDay(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

  const [rollupRows, todayRows] = await Promise.all([
    db
      .select({
        owner: downloadRollups.owner,
        name: downloadRollups.name,
        count: sql<number>`sum(${downloadRollups.count})::int`,
      })
      .from(downloadRollups)
      .where(and(gte(downloadRollups.day, since), lt(downloadRollups.day, today)))
      .groupBy(downloadRollups.owner, downloadRollups.name),
    db
      .select({
        owner: downloadEvents.owner,
        name: downloadEvents.name,
        count: sql<number>`count(*)::int`,
      })
      .from(downloadEvents)
      .where(eq(downloadEvents.day, today))
      .groupBy(downloadEvents.owner, downloadEvents.name),
  ]);

  if (rollupRows.length === 0) {
    const fallback = await db
      .select({
        owner: downloadEvents.owner,
        name: downloadEvents.name,
        count: sql<number>`count(distinct ${downloadEvents.clientHash})::int`,
      })
      .from(downloadEvents)
      .where(gte(downloadEvents.day, since))
      .groupBy(downloadEvents.owner, downloadEvents.name);
    for (const row of fallback) out.set(`${row.owner}/${row.name}`, row.count);
    return out;
  }

  for (const row of rollupRows) out.set(`${row.owner}/${row.name}`, row.count);
  for (const row of todayRows) {
    const key = `${row.owner}/${row.name}`;
    out.set(key, (out.get(key) ?? 0) + row.count);
  }
  return out;
}

/** `sort=trending` (G-S4). No DB (or a DB error) means zero download events
 *  were ever recorded, which is indistinguishable from "nothing is trending
 *  yet" — so this degrades to the same recency ordering as `sort=updated`
 *  rather than a page of arbitrary zeros. Also stamps each item's real 7-day
 *  count onto `stats.trending` (see the doc comment in types.ts) so a caller
 *  like the landing page's "Most installed this week" rail can tell an
 *  actually-trending package from ordering filler. */
async function sortByTrending(db: Db | null, items: PackageSummary[]): Promise<PackageSummary[]> {
  if (!db) return sortSummaries(items, "updated");
  const counts = await safe(
    queryTrendingCounts(
      db,
      items.map((i) => ({ owner: i.owner, name: i.name }))
    ),
    "trending query",
    new Map<string, number>()
  );
  const stamped = items.map((item) => ({
    ...item,
    stats: { ...item.stats, trending: counts.get(`${item.owner}/${item.name}`) ?? 0 },
  }));
  return stamped.sort((a, b) => {
    const diff = (b.stats.trending ?? 0) - (a.stats.trending ?? 0);
    if (diff !== 0) return diff;
    return (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || a.name.localeCompare(b.name)
    );
  });
}

/** Global (unfiltered) name/tag vocabulary for typo correction (G-S1),
 *  covering both sources — a corrected term has to exist in whichever
 *  catalog actually holds it, and a filter unrelated to the typo (kind,
 *  runtime, ...) shouldn't prevent finding the correction in the first
 *  place. Best-effort: a DB error just means correction falls back to the
 *  seed-only vocabulary, same as when there's no DB at all. */
async function buildGlobalVocabulary(
  db: Db | null,
  seed: Catalog
): Promise<{ name: string; tags: string[] }[]> {
  const [seedAll, dbRows] = await Promise.all([
    seed.list({ limit: CATALOG_ALL_LIMIT }),
    db
      ? safe(db.select({ name: packages.name, tags: packages.tags }).from(packages), "vocabulary query", [])
      : Promise.resolve([]),
  ]);
  return [
    ...seedAll.items.map((p) => ({ name: p.name, tags: p.tags })),
    ...dbRows.map((r) => ({ name: r.name, tags: r.tags })),
  ];
}

export function createDbCatalog(seed: Catalog): Catalog {
  /** Fetches and merges the full (unpaginated) filtered set for one term list
   *  — factored out of `list()` so the typo-correction retry can call it a
   *  second time with a corrected `q` without duplicating the merge logic. */
  async function fetchCombined(
    db: Db | null,
    effectiveQuery: CatalogQuery,
    effectiveTerms: string[]
  ): Promise<{ items: PackageSummary[]; seedCorrectedQuery?: string }> {
    // Explicit ceiling, not `undefined` — see CATALOG_ALL_LIMIT. Merging needs
    // every matching seed package, then this layer pages the merged result.
    const seedQuery: CatalogQuery = { ...effectiveQuery, limit: CATALOG_ALL_LIMIT, offset: 0 };
    const [seedPage, dbSummaries] = await Promise.all([
      seed.list(seedQuery),
      db ? safe(queryDbSummaries(db, effectiveQuery, effectiveTerms), "list query", []) : Promise.resolve([]),
    ]);
    return {
      items: mergeSummaries(seedPage.items, dbSummaries),
      // The seed catalog self-corrects typos; surface that so the caller can tell
      // the user what was actually searched for.
      seedCorrectedQuery: seedPage.correctedQuery,
    };
  }

  return {
    async list(query: CatalogQuery = {}): Promise<CatalogPage> {
      const db = getDb();
      const rawTerms = query.q ? tokenize(query.q) : [];

      const first = await fetchCombined(db, query, rawTerms);
      let combined = first.items;
      let correctedQuery: string | undefined =
        combined.length > 0 ? first.seedCorrectedQuery : undefined;
      let terms = correctedQuery ? tokenize(correctedQuery) : rawTerms;

      // G-S1 typo tolerance: seed.list() already self-corrects within its own
      // vocabulary (so zero-env mode gets this for free), but a zero *merged*
      // result here needs its own retry — the seed catalog alone matching
      // nothing doesn't mean the combined set won't once corrected against
      // the fuller (seed + DB) vocabulary.
      if (rawTerms.length > 0 && combined.length === 0) {
        const vocabulary = buildVocabulary(await buildGlobalVocabulary(db, seed));
        const correction = buildCorrectedQuery(rawTerms, vocabulary);
        if (correction.correctedQuery) {
          const retried = await fetchCombined(
            db,
            { ...query, q: correction.correctedQuery },
            correction.terms
          );
          if (retried.items.length > 0) {
            combined = retried.items;
            terms = correction.terms;
            correctedQuery = correction.correctedQuery;
          }
        }
      }

      // No explicit sort and a search query: rank by relevance, same tiering as
      // the seed catalog, via the one shared helper in ./search. An explicit
      // "trending" sort needs its own (async, DB-backed) path; everything else
      // keeps the existing name/recency ordering.
      const merged =
        terms.length > 0 && !query.sort
          ? rankByQuery(combined, terms)
          : query.sort === "trending"
            ? await sortByTrending(db, combined)
            : sortSummaries(combined, query.sort);
      const offset = query.offset ?? 0;
      // `query.limit` is always set by now — `parseCatalogQuery` defaults it, and
      // internal callers pass CATALOG_ALL_LIMIT explicitly. No default here.
      const limit = query.limit!;
      return { items: merged.slice(offset, offset + limit), total: merged.length, correctedQuery };
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
                return {
                  path: fileRow.path,
                  size: fileRow.size,
                  content: fileRow.content,
                  encoding: fileRow.encoding as "utf8" | "base64",
                  mode: fileRow.mode ?? undefined,
                };
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
      // G-P3: `handle` may name a user OR an organization — they share one
      // namespace (see reserved.ts's `isHandleTaken`), so a package's `owner`
      // resolves the same way regardless of which one actually owns it. Org
      // rows win over a user row on the rare handle collision that shouldn't
      // exist in practice (creation checks both tables), same precedence
      // `dbUser` already had over `seedCreator` below.
      const [seedCreator, dbUser, dbOrg, dbPackageCount] = await Promise.all([
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
              db.select().from(organizations).where(eq(organizations.handle, handle)).limit(1).then((r) => r[0]),
              `creator(${handle}) org lookup`,
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

      if (!seedCreator && !dbUser && !dbOrg) return null;

      return {
        handle,
        displayName: dbOrg?.displayName ?? dbUser?.name ?? seedCreator?.displayName ?? handle,
        bio: dbOrg?.bio ?? dbUser?.bio ?? seedCreator?.bio,
        avatarUrl: dbOrg?.avatarUrl ?? dbUser?.image ?? seedCreator?.avatarUrl,
        url: dbOrg?.website ?? dbUser?.website ?? seedCreator?.url,
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

    async facets(query: CatalogQuery = {}): Promise<FacetCounts> {
      const db = getDb();
      const terms = query.q ? tokenize(query.q) : [];

      // One merged (seed + DB) set per dimension, each with that dimension's
      // own filter excluded — see the `skip` param on `buildWhere`/
      // `applyFilters` and the `FacetCounts` doc comment in types.ts.
      async function dimension(skip: FacetDimension): Promise<PackageSummary[]> {
        // Fetch every seed item with *no* filters applied by seed.list() itself
        // (not even `q`) — every filter, including which dimension to skip, is
        // applied by this function instead, so it stays in lockstep with the
        // equivalent `skip` passed to `queryDbSummaries` on the DB side below.
        const [seedAll, dbSummaries] = await Promise.all([
          seed.list({ limit: CATALOG_ALL_LIMIT, offset: 0 }),
          db ? safe(queryDbSummaries(db, query, terms, skip), `facets(${skip}) query`, []) : Promise.resolve([]),
        ]);
        const termFiltered =
          terms.length > 0 ? seedAll.items.filter((p) => matchesTerms(terms, fieldsOf(p))) : seedAll.items;
        return mergeSummaries(applySeedDimensionFilter(termFiltered, query, skip), dbSummaries);
      }

      const [kindItems, runtimeItems, priceItems, tagItems] = await Promise.all([
        dimension("kind"),
        dimension("runtime"),
        dimension("price"),
        dimension("tag"),
      ]);

      const kind: Partial<Record<PackageKind, number>> = {};
      for (const k of PACKAGE_KINDS) {
        const count = kindItems.filter((p) => p.kind === k).length;
        if (count > 0) kind[k] = count;
      }

      const runtime: Partial<Record<RuntimeId, number>> = {};
      for (const r of RUNTIME_IDS) {
        const count = runtimeItems.filter((p) => p.runtimes.includes(r)).length;
        if (count > 0) runtime[r] = count;
      }

      const price = {
        free: priceItems.filter((p) => p.pricing.model === "free").length,
        paid: priceItems.filter((p) => p.pricing.model !== "free").length,
      };

      const tagCounts = new Map<string, number>();
      for (const p of tagItems) {
        for (const tag of p.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
      const tags = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        .slice(0, 20);

      return { kind, runtime, price, tags };
    },
  };
}

/** The non-`q` filters `seed.ts`'s own `list()`/`facets()` apply, duplicated
 *  here (rather than exported from seed.ts) because `dimension()` above needs
 *  the filtered *items*, not seed.ts's pre-aggregated `FacetCounts`. Kept in
 *  lockstep with `applyFilters` in `catalog/seed.ts` by hand — both are one
 *  screenful and change together; there's no automated seed/DB facet-parity
 *  test yet (see the final report's "left undone"). */
function applySeedDimensionFilter(
  items: PackageSummary[],
  query: CatalogQuery,
  skip: FacetDimension
): PackageSummary[] {
  let out = items;
  if (query.kind && skip !== "kind") out = out.filter((p) => p.kind === query.kind);
  if (query.runtime && skip !== "runtime") out = out.filter((p) => p.runtimes.includes(query.runtime!));
  if (skip !== "price") {
    if (query.price === "free") out = out.filter((p) => p.pricing.model === "free");
    if (query.price === "paid") out = out.filter((p) => p.pricing.model !== "free");
  }
  if (query.tag && skip !== "tag") out = out.filter((p) => p.tags.includes(query.tag!));
  if (query.owner && skip !== "owner") out = out.filter((p) => p.owner === query.owner);
  return out;
}

/** Search fields for `matchesTerms` — mirrors `fieldsOf` in `catalog/seed.ts`
 *  so the two catalogs can never disagree about which columns a query term
 *  can hit. Duplicated rather than imported because `seed.ts`'s copy is
 *  module-private; both are one-line and exercised by the shared search
 *  tests via `matchesTerms` itself. */
function fieldsOf(p: PackageSummary): string[] {
  return [p.title, p.summary, p.name, p.owner, ...p.tags];
}
