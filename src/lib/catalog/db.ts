// DB-backed Catalog implementation. Queries Postgres via Drizzle and merges results
// with the seed (on-disk) catalog: seed items are the base set, DB items win on id
// conflicts, and combined DB+seed packages/tags feed list/featured/tags queries.
//
// createDbCatalog() is only meant to be invoked by src/lib/catalog/index.ts when
// DATABASE_URL is set, but every exported function here degrades gracefully (falls
// back to the seed catalog, or is a no-op) if getDb() returns null.

import { and, eq, ilike, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packageFiles, packages, packageVersions, stars, users } from "@/lib/db/schema";
import type {
  Catalog,
  CatalogPage,
  CatalogQuery,
  Creator,
  Manifest,
  Package,
  PackageFile,
  PackageKind,
  PackageSummary,
  PricingModel,
  RuntimeId,
} from "@/lib/types";

type Db = NonNullable<ReturnType<typeof getDb>>;
type PackageRow = typeof packages.$inferSelect;

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
    stats: { downloads: row.downloads, stars: row.stars },
    featured: row.featured,
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
    stats: { downloads: row.downloads, stars: row.stars },
    featured: row.featured,
    source: "db",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildWhere(db: Db, query: CatalogQuery) {
  const conditions = [];
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
  if (query.q) {
    const like = `%${query.q}%`;
    conditions.push(
      or(
        ilike(packages.title, like),
        ilike(packages.summary, like),
        ilike(packages.name, like)
      )
    );
  }
  return conditions.length ? and(...conditions) : undefined;
}

async function queryDbSummaries(db: Db, query: CatalogQuery): Promise<PackageSummary[]> {
  const where = buildWhere(db, query);
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

function sortSummaries(items: PackageSummary[], sort: CatalogQuery["sort"]): PackageSummary[] {
  const arr = [...items];
  switch (sort) {
    case "stars":
      arr.sort((a, b) => b.stats.stars - a.stats.stars);
      break;
    case "updated":
      arr.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      break;
    case "name":
      arr.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "downloads":
    default:
      arr.sort((a, b) => b.stats.downloads - a.stats.downloads);
      break;
  }
  return arr;
}

export function createDbCatalog(seed: Catalog): Catalog {
  return {
    async list(query: CatalogQuery = {}): Promise<CatalogPage> {
      const db = getDb();
      const seedQuery: CatalogQuery = { ...query, limit: undefined, offset: undefined };
      const [seedPage, dbSummaries] = await Promise.all([
        seed.list(seedQuery),
        db ? queryDbSummaries(db, query) : Promise.resolve([]),
      ]);
      const merged = sortSummaries(mergeSummaries(seedPage.items, dbSummaries), query.sort);
      const offset = query.offset ?? 0;
      const limit = query.limit ?? merged.length;
      return { items: merged.slice(offset, offset + limit), total: merged.length };
    },

    async get(owner: string, name: string): Promise<Package | null> {
      const db = getDb();
      if (db) {
        const [row] = await db
          .select()
          .from(packages)
          .where(and(eq(packages.owner, owner), eq(packages.name, name)))
          .limit(1);
        if (row) return rowToPackage(db, row);
      }
      return seed.get(owner, name);
    },

    async getFile(owner: string, name: string, path: string): Promise<PackageFile | null> {
      const db = getDb();
      if (db) {
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
      }
      return seed.getFile(owner, name, path);
    },

    async creator(handle: string): Promise<Creator | null> {
      const db = getDb();
      const [seedCreator, dbUser, dbPackageCount] = await Promise.all([
        seed.creator(handle),
        db
          ? db.select().from(users).where(eq(users.handle, handle)).limit(1).then((r) => r[0])
          : Promise.resolve(undefined),
        db
          ? db
              .select({ id: packages.id })
              .from(packages)
              .where(eq(packages.owner, handle))
              .then((r) => r.length)
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
          ? db.select().from(packages).where(eq(packages.featured, true))
          : Promise.resolve([]),
      ]);
      const merged = sortSummaries(
        mergeSummaries(seedItems, dbRows.map(rowToSummary)),
        "downloads"
      );
      return merged.slice(0, limit);
    },

    async tags(): Promise<{ tag: string; count: number }[]> {
      const db = getDb();
      const [seedTags, dbRows] = await Promise.all([
        seed.tags(),
        db ? db.select({ tags: packages.tags }).from(packages) : Promise.resolve([]),
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

/** Increments the download counter for a DB-backed package. No-op when DB is disabled
 *  or the package isn't found in the DB (e.g. it's a seed-only package). */
export async function recordDownload(owner: string, name: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(packages)
    .set({ downloads: sql`${packages.downloads} + 1` })
    .where(and(eq(packages.owner, owner), eq(packages.name, name)));
}

/** Toggles a star for (userId, packageId), keeping packages.stars in sync.
 *  Returns the new starred state and the package's updated star count.
 *  No-ops (returns null) when DB is disabled. */
export async function toggleStar(
  userId: string,
  packageId: string
): Promise<{ starred: boolean; stars: number } | null> {
  const db = getDb();
  if (!db) return null;

  const [existing] = await db
    .select()
    .from(stars)
    .where(and(eq(stars.userId, userId), eq(stars.packageId, packageId)))
    .limit(1);

  if (existing) {
    await db
      .delete(stars)
      .where(and(eq(stars.userId, userId), eq(stars.packageId, packageId)));
    const [row] = await db
      .update(packages)
      .set({ stars: sql`greatest(${packages.stars} - 1, 0)` })
      .where(eq(packages.id, packageId))
      .returning({ stars: packages.stars });
    return { starred: false, stars: row?.stars ?? 0 };
  }

  await db.insert(stars).values({ userId, packageId });
  const [row] = await db
    .update(packages)
    .set({ stars: sql`${packages.stars} + 1` })
    .where(eq(packages.id, packageId))
    .returning({ stars: packages.stars });
  return { starred: true, stars: row?.stars ?? 0 };
}
