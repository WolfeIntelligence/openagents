// Site-wide "what's new" feed (Z3): the newest published versions across
// every live package, each carrying its own changelog text. Shared by the
// `/changelog` page and the `/changelog.xml` RSS feed so the two can never
// disagree about what "recent" means — factored out the same way
// `packageDiff.ts` is shared by the diff API route and the compare page.
//
// Reuses `getCatalog()` (works across the seed and DB catalogs alike) and
// `listVersions` (per-package version history, already newest-first) rather
// than querying `package_versions` directly — "live" is a catalog-layer
// concept (seed packages are always live; DB packages can be
// pending/unlisted/deprecated), so filtering happens in those terms instead
// of re-deriving them here. Safe to import with zero env vars, like both of
// its dependencies.

import { getCatalog } from "@/lib/catalog";
import { listVersions } from "@/lib/catalog/versions";
import { CATALOG_ALL_LIMIT, type PackageKind } from "@/lib/types";

export interface ChangelogEntry {
  owner: string;
  name: string;
  title: string;
  kind: PackageKind;
  version: string;
  publishedAt: string;
  changelog?: string;
  /** Set when an older version of this package exists, so callers can link to
   *  `/p/{owner}/{name}/compare?from={previousVersion}&to={version}`. */
  previousVersion?: string;
}

/** Newest entries returned by `listRecentChangelogEntries` — matches
 *  `feed.xml`'s own FEED_SIZE convention for "recent activity" feeds. */
export const CHANGELOG_FEED_SIZE = 50;

/**
 * Newest `CHANGELOG_FEED_SIZE` versions across every live package, optionally
 * restricted to one owner (`?owner=`). A package with several versions can
 * contribute more than one entry — a changelog feed is about every release,
 * not just each package's current state.
 */
export async function listRecentChangelogEntries(opts: { owner?: string } = {}): Promise<ChangelogEntry[]> {
  const catalog = await getCatalog();
  const { items } = await catalog.list({ owner: opts.owner, limit: CATALOG_ALL_LIMIT });
  // Same "live only" rule as feed.xml: deprecated/pending/unlisted packages
  // can still sort into a plain updatedAt-ordered list, so filter explicitly
  // rather than relying on `catalog.list`'s default visibility rules.
  const live = items.filter((pkg) => pkg.status === "live");

  const perPackage = await Promise.all(
    live.map(async (pkg): Promise<ChangelogEntry[]> => {
      const versions = await listVersions(pkg.owner, pkg.name); // newest-first
      return versions.map((v, i) => ({
        owner: pkg.owner,
        name: pkg.name,
        title: pkg.title,
        kind: pkg.kind,
        version: v.version,
        publishedAt: v.publishedAt,
        changelog: v.changelog,
        previousVersion: versions[i + 1]?.version,
      }));
    })
  );

  // ISO 8601 timestamps sort lexicographically in chronological order, so a
  // plain string compare is enough here.
  return perPackage
    .flat()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, CHANGELOG_FEED_SIZE);
}
