// Per-version package lookups (S4/G-V1): version history, a specific
// version's full package data, and reading one file as of a specific version.
//
// Deliberately separate from src/lib/catalog/{index,seed,db}.ts — those are
// owned by another workstream — but mirrors their conventions: `getDb()` is
// called directly, every export degrades to the seed catalog (or an empty
// result) when DATABASE_URL is unset or the query fails, and this module is
// safe to import with zero env vars.
//
// Note: unlike ./db, functions here do not attach real download/star counts
// via `withStats` (that decorator lives in ./index, which this module must
// not depend on to avoid a cycle with the other workstream's file). They call
// `getStats` directly instead, so the numbers are still real — just fetched
// here rather than borrowed from the shared decorator.

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packageFiles, packages, packageVersions } from "@/lib/db/schema";
import { seedCatalog } from "@/lib/catalog/seed";
import { compareSemver } from "@/lib/semver";
import { getStats, statsKey, ZERO_STATS } from "@/lib/stats";
import type { Manifest, Package, PackageFile, PackageStatus, PackageVersion } from "@/lib/types";

type Db = NonNullable<ReturnType<typeof getDb>>;
type PackageRow = typeof packages.$inferSelect;
type VersionRow = typeof packageVersions.$inferSelect;

/** Newest-first ordering by semver precedence — not insertion or publish-time
 *  order, which could tie or skew under clock issues. Pure and exported so it
 *  can be unit-tested directly (a fake DB is impractical to test ordering
 *  against; see versions.test.ts). Falls back to `publishedAt` only if a
 *  version string somehow isn't valid semver (publish.ts's schema already
 *  rejects that at write time, so this is defense-in-depth, not the normal path). */
export function sortVersionsDesc(versions: PackageVersion[]): PackageVersion[] {
  return [...versions].sort((a, b) => {
    try {
      return compareSemver(b.version, a.version);
    } catch {
      return b.publishedAt.localeCompare(a.publishedAt);
    }
  });
}

function toPackageVersion(row: VersionRow): PackageVersion {
  return {
    version: row.version,
    publishedAt: row.publishedAt.toISOString(),
    changelog: row.changelog ?? undefined,
  };
}

/** Newest-first version list. Seed packages always report exactly one entry
 *  (their current manifest version — see seed.ts's `versions` field); every
 *  DB package has at least one row from its first publish. */
export async function listVersions(owner: string, name: string): Promise<PackageVersion[]> {
  const db = getDb();
  if (db) {
    try {
      const [row] = await db
        .select({ id: packages.id })
        .from(packages)
        .where(and(eq(packages.owner, owner), eq(packages.name, name)))
        .limit(1);
      if (row) {
        const versionRows = await db
          .select()
          .from(packageVersions)
          .where(eq(packageVersions.packageId, row.id));
        return sortVersionsDesc(versionRows.map(toPackageVersion));
      }
    } catch (err) {
      console.error(`[catalog/versions] listVersions(${owner}/${name}) failed, falling back to seed:`, err);
    }
  }
  const pkg = await seedCatalog.get(owner, name);
  return pkg ? pkg.versions : [];
}

async function buildPackageForVersion(db: Db, row: PackageRow, versionRow: VersionRow): Promise<Package> {
  const [fileRows, allVersionRows, statsMap] = await Promise.all([
    db
      .select({
        path: packageFiles.path,
        size: packageFiles.size,
        encoding: packageFiles.encoding,
        mode: packageFiles.mode,
      })
      .from(packageFiles)
      .where(eq(packageFiles.versionId, versionRow.id)),
    db.select().from(packageVersions).where(eq(packageVersions.packageId, row.id)),
    getStats([{ owner: row.owner, name: row.name }]),
  ]);

  return {
    id: `${row.owner}/${row.name}`,
    owner: row.owner,
    name: row.name,
    // The manifest as it was published for *this* version, not the package's
    // current one — that's the whole point of a versioned lookup.
    manifest: versionRow.manifest as Manifest,
    readme: versionRow.readme,
    files: fileRows.map(
      (f): PackageFile => ({
        path: f.path,
        size: f.size,
        encoding: f.encoding as "utf8" | "base64",
        mode: f.mode ?? undefined,
      })
    ),
    versions: sortVersionsDesc(allVersionRows.map(toPackageVersion)),
    stats: statsMap.get(statsKey(row.owner, row.name)) ?? ZERO_STATS,
    featured: row.featured,
    ownerType: row.ownerType === "org" ? "org" : "user",
    status: row.status as PackageStatus,
    deprecation:
      row.status === "deprecated"
        ? { message: row.deprecationMessage ?? undefined, replacementId: row.replacementId ?? undefined }
        : undefined,
    source: "db",
    createdAt: row.createdAt.toISOString(),
    // Reflects when *this* version went live, not the package's latest publish.
    updatedAt: versionRow.publishedAt.toISOString(),
  };
}

/**
 * A `Package`-shaped view of one specific published version, reusing the
 * `package_versions`/`package_files` rows written by publish.ts. Returns null
 * when the package doesn't exist, or when it exists but never published that
 * version (DB packages don't fall through to the seed catalog in that case —
 * same "package exists here, resource doesn't" rule as `db.ts`'s `getFile`).
 *
 * Seed packages only ever know their current version (S4): `version` must
 * equal `manifest.version` or this returns null.
 */
export async function getPackageVersion(owner: string, name: string, version: string): Promise<Package | null> {
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
          .where(and(eq(packageVersions.packageId, row.id), eq(packageVersions.version, version)))
          .limit(1);
        if (!versionRow) return null;
        return await buildPackageForVersion(db, row, versionRow);
      }
    } catch (err) {
      console.error(
        `[catalog/versions] getPackageVersion(${owner}/${name}, ${version}) failed, falling back to seed:`,
        err
      );
    }
  }
  const pkg = await seedCatalog.get(owner, name);
  if (!pkg || pkg.manifest.version !== version) return null;
  return pkg;
}

/**
 * One file's content as of a specific published version. 404-worthy cases
 * (unknown package, unknown version, unknown path) all resolve to null.
 */
export async function getFileAtVersion(
  owner: string,
  name: string,
  version: string,
  filePath: string
): Promise<PackageFile | null> {
  const db = getDb();
  if (db) {
    try {
      const [row] = await db
        .select({ id: packages.id })
        .from(packages)
        .where(and(eq(packages.owner, owner), eq(packages.name, name)))
        .limit(1);
      if (row) {
        const [versionRow] = await db
          .select({ id: packageVersions.id })
          .from(packageVersions)
          .where(and(eq(packageVersions.packageId, row.id), eq(packageVersions.version, version)))
          .limit(1);
        if (!versionRow) return null; // package exists, this version doesn't
        const [fileRow] = await db
          .select()
          .from(packageFiles)
          .where(and(eq(packageFiles.versionId, versionRow.id), eq(packageFiles.path, filePath)))
          .limit(1);
        return fileRow
          ? {
              path: fileRow.path,
              size: fileRow.size,
              content: fileRow.content,
              encoding: fileRow.encoding as "utf8" | "base64",
              mode: fileRow.mode ?? undefined,
            }
          : null;
      }
    } catch (err) {
      console.error(
        `[catalog/versions] getFileAtVersion(${owner}/${name}, ${version}, ${filePath}) failed, falling back to seed:`,
        err
      );
    }
  }
  const pkg = await seedCatalog.get(owner, name);
  if (!pkg || pkg.manifest.version !== version) return null;
  return seedCatalog.getFile(owner, name, filePath);
}
