// Seed catalog: reads packages from `catalog/<owner>/<name>/` on disk at
// request time. Always available (no env vars required). Never throws —
// a missing `catalog/` directory or a broken individual package yields an
// empty/partial result, not a crash. See SPEC.md "Architecture".
//
// NOTE: SPEC.md asks for `import "server-only"` here. That package is not
// declared as a project dependency (task instructions say not to run `npm
// install`), and `scripts/check-catalog.ts` needs to load this module
// directly through `tsx` outside of Next's bundler/webpack aliasing, where a
// bare `server-only` import would fail to resolve. This module already only
// touches Node's `fs`/`path`, so it is deliberately omitted; every caller in
// this codebase is server-side (Route Handlers, RSC, the check-catalog
// script) anyway. Flagging this as an intentional deviation from spec.

import fs from "node:fs";
import path from "node:path";
import { isExecutableName, isProbablyBinary } from "@/lib/files";
import { parseManifest, validateManifestFiles } from "@/lib/manifest";
import { buildCorrectedQuery, buildVocabulary, matchesTerms, rankByQuery, tokenize } from "@/lib/search";
import {
  PACKAGE_KINDS,
  RUNTIME_IDS,
  toSummary,
  type Catalog,
  type CatalogPage,
  type CatalogQuery,
  type Creator,
  type FacetCounts,
  type Package,
  type PackageFile,
  type PackageSummary,
} from "@/lib/types";

const CATALOG_ROOT = path.join(process.cwd(), "catalog");
const BUILD_TIME = new Date().toISOString();

/** `.meta.json` — the two things about a package that aren't derivable from its
 *  own files: the editorial `featured` flag and real git-derived timestamps.
 *  Written by `scripts/sync-catalog-meta.ts`. Never holds download/star counts:
 *  those are real counters in the database, applied by `withStats` in `./index`. */
interface MetaFile {
  featured?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface OwnerFile {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  url?: string;
}

export interface CatalogLoadError {
  owner: string;
  name: string;
  message: string;
}

interface LoadResult {
  packages: Package[];
  errors: CatalogLoadError[];
}

let cache: LoadResult | null = null;

/** Recursively lists files under `dir`, returning POSIX-style paths relative to `base`. */
function listFilesRecursive(dir: string, base: string = dir): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * POSIX file mode for a seed-catalog file, or `undefined` for the default
 * 0o644. `fs.statSync(...).mode`'s executable bit is meaningful on POSIX
 * (where the catalog's own `bin/`/`scripts/` files are checked out with it
 * set), but Node reports a fixed, useless value for it on Windows — every
 * file looks the same regardless of what a `chmod +x` on another OS did. So
 * on Windows (and as a fallback anywhere the bit isn't set), fall back to
 * `isExecutableName`'s name-based heuristic instead of trusting the stat.
 */
function seedFileMode(stat: fs.Stats, relPath: string): number | undefined {
  const posixExecutable = process.platform !== "win32" && (stat.mode & 0o111) !== 0;
  if (posixExecutable) return 0o755;
  return isExecutableName(relPath) ? 0o755 : undefined;
}

function readJsonSafe<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function loadPackage(owner: string, name: string, pkgPath: string): Package | null {
  const manifestPath = path.join(pkgPath, "openagent.yaml");
  if (!fs.existsSync(manifestPath)) return null;

  const yamlText = fs.readFileSync(manifestPath, "utf-8");
  const manifest = parseManifest(yamlText); // throws ManifestError on invalid manifest

  if (manifest.owner !== owner || manifest.name !== name) {
    throw new Error(
      `manifest owner/name ("${manifest.owner}/${manifest.name}") does not match directory catalog/${owner}/${name}`
    );
  }

  const availablePaths = listFilesRecursive(pkgPath);
  const fileErrors = validateManifestFiles(manifest, availablePaths);
  if (fileErrors.length > 0) {
    throw new Error(fileErrors.join("; "));
  }

  const readmePath = path.join(pkgPath, "README.md");
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf-8") : "";

  const manifestStat = fs.statSync(manifestPath);
  const mtimes = [manifestStat.mtimeMs];
  if (fs.existsSync(readmePath)) mtimes.push(fs.statSync(readmePath).mtimeMs);

  const files: PackageFile[] = manifest.files.map((f) => {
    const full = path.join(pkgPath, f);
    const stat = fs.statSync(full);
    mtimes.push(stat.mtimeMs);
    return { path: f, size: stat.size, mode: seedFileMode(stat, f) };
  });

  const meta = readJsonSafe<MetaFile>(path.join(pkgPath, ".meta.json")) ?? {};

  // Deployed bundles (e.g. Vercel) normalize file mtimes to a bogus epoch, so
  // prefer the real git-derived dates in .meta.json and fall back to build time
  // when the filesystem dates look fake.
  const buildTime = BUILD_TIME;
  const plausible = (ms: number) => ms > Date.UTC(2020, 0, 1);
  const createdAt =
    meta.createdAt ??
    (plausible(Math.min(...mtimes)) ? new Date(Math.min(...mtimes)).toISOString() : buildTime);
  const updatedAt =
    meta.updatedAt ??
    (plausible(Math.max(...mtimes)) ? new Date(Math.max(...mtimes)).toISOString() : buildTime);

  const pkg: Package = {
    id: `${owner}/${name}`,
    owner,
    name,
    manifest,
    readme,
    files,
    versions: [{ version: manifest.version, publishedAt: updatedAt }],
    // Seed packages live on disk and carry no counters of their own. Real
    // download/star counts are stored in the database against (owner, name) and
    // layered on by `withStats` in `./index`; zero here means "not counted yet",
    // never a placeholder.
    stats: { downloads: 0, stars: 0 },
    featured: meta.featured ?? false,
    ownerType: "user", // seed owners are plain handles (see catalog/<owner>/owner.json)
    status: "live", // seed packages are reviewed by pull request, so always live
    source: "seed",
    createdAt,
    updatedAt,
  };
  return pkg;
}

function loadAll(): LoadResult {
  if (cache) return cache;

  const packages: Package[] = [];
  const errors: CatalogLoadError[] = [];

  let ownerDirs: fs.Dirent[] = [];
  try {
    if (fs.existsSync(CATALOG_ROOT)) {
      ownerDirs = fs.readdirSync(CATALOG_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
    }
  } catch {
    ownerDirs = [];
  }

  for (const ownerDir of ownerDirs) {
    const owner = ownerDir.name;
    const ownerPath = path.join(CATALOG_ROOT, owner);
    let nameDirs: fs.Dirent[] = [];
    try {
      nameDirs = fs.readdirSync(ownerPath, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const nameDir of nameDirs) {
      const name = nameDir.name;
      const pkgPath = path.join(ownerPath, name);
      try {
        const pkg = loadPackage(owner, name, pkgPath);
        if (pkg) packages.push(pkg);
      } catch (err) {
        errors.push({
          owner,
          name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  cache = { packages, errors };
  return cache;
}

function loadAllPackages(): Package[] {
  return loadAll().packages;
}

/** Load errors from the last catalog scan — used by `scripts/check-catalog.ts`. */
export function loadCatalogErrors(): CatalogLoadError[] {
  return loadAll().errors;
}

/** Clears the in-process cache. Mainly useful for tests/scripts that mutate `catalog/` mid-run. */
export function clearSeedCatalogCache(): void {
  cache = null;
}

function normalizeRelativePath(input: string): string | null {
  if (!input) return null;
  const posix = input.split(path.sep).join("/");
  if (posix.startsWith("/") || /^[a-zA-Z]:/.test(posix)) return null; // absolute path
  const parts = posix.split("/");
  if (parts.some((p) => p === "..")) return null; // traversal
  const cleaned = parts.filter((p) => p !== "." && p !== "").join("/");
  return cleaned || null;
}

/** Search fields for `matchesTerms`/typo-correction — the one place that
 *  decides which columns a query term can hit, so `list()` and its retry
 *  pass can't quietly disagree with each other. */
function fieldsOf(p: PackageSummary): string[] {
  return [p.title, p.summary, p.name, p.owner, ...p.tags];
}

type FacetDimension = "kind" | "runtime" | "price" | "tag" | "owner";

/** Applies every non-`q` filter in `query`, optionally skipping one dimension
 *  — used both by `list()` (skip nothing) and `facets()` (skip the dimension
 *  being counted, so a facet's own filter never zeroes out its own count;
 *  see the `FacetCounts` doc comment in types.ts). */
function applyFilters(
  items: PackageSummary[],
  query: CatalogQuery,
  skip?: FacetDimension
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

async function list(query: CatalogQuery = {}): Promise<CatalogPage> {
  const packages = loadAllPackages();
  const allSummaries = packages.map(toSummary);
  const baseFiltered = applyFilters(allSummaries, query);

  // Terms are ANDed across name/title/summary/owner/tags (a hyphenated tag like
  // "code-review" also matches "review" from `q=code review`) — see B9a/B9c and
  // the shared helper's own doc comment.
  const rawTerms = query.q ? tokenize(query.q) : [];
  let terms = rawTerms;
  let items = baseFiltered;
  let correctedQuery: string | undefined;

  if (rawTerms.length > 0) {
    items = baseFiltered.filter((p) => matchesTerms(rawTerms, fieldsOf(p)));
    if (items.length === 0) {
      // G-S1 typo tolerance: retry once against the catalog's own name/tag
      // vocabulary before giving up. Vocabulary is built from every package
      // (not just `baseFiltered`) so a typo can still be corrected even when
      // combined with a kind/runtime/tag/owner filter that happens to exclude
      // the only matching package's other fields.
      const vocabulary = buildVocabulary(packages.map((p) => ({ name: p.name, tags: p.manifest.tags })));
      const correction = buildCorrectedQuery(rawTerms, vocabulary);
      if (correction.correctedQuery) {
        const retried = baseFiltered.filter((p) => matchesTerms(correction.terms, fieldsOf(p)));
        if (retried.length > 0) {
          items = retried;
          terms = correction.terms;
          correctedQuery = correction.correctedQuery;
        }
      }
    }
  }

  let sorted: PackageSummary[];
  if (terms.length > 0 && !query.sort) {
    // No explicit sort and a search query: rank by relevance (see search.ts's
    // `scoreDocument`) rather than plain recency.
    sorted = rankByQuery(items, terms);
  } else {
    // Default to "updated": this layer's counters are always zero (see
    // loadPackage), so `withStats` re-sorts by the real numbers when sort is
    // downloads/stars. "trending" also falls through to "updated" here —
    // this catalog has no DB-backed download_events to compute it from (G-S4).
    const sort = query.sort ?? "updated";
    sorted = [...items].sort((a, b) => {
      switch (sort) {
        case "stars":
          return b.stats.stars - a.stats.stars || b.updatedAt.localeCompare(a.updatedAt);
        case "name":
          return a.name.localeCompare(b.name);
        case "downloads":
          return b.stats.downloads - a.stats.downloads || b.updatedAt.localeCompare(a.updatedAt);
        case "updated":
        case "trending":
        default:
          return b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name);
      }
    });
  }

  const total = sorted.length;
  const offset = query.offset ?? 0;
  // `query.limit` is always set by now — `parseCatalogQuery` defaults it, and
  // internal callers pass CATALOG_ALL_LIMIT explicitly. No default here.
  const limit = query.limit!;
  const page = sorted.slice(offset, offset + limit);
  return { items: page, total, correctedQuery };
}

async function facets(query: CatalogQuery = {}): Promise<FacetCounts> {
  const allSummaries = loadAllPackages().map(toSummary);
  const terms = query.q ? tokenize(query.q) : [];
  // The query-term filter always applies (it isn't one of the facet
  // dimensions a user can "remove" from the sidebar); only kind/runtime/
  // price/tag are computed with their own filter excluded.
  const withTerms = (items: PackageSummary[]) =>
    terms.length > 0 ? items.filter((p) => matchesTerms(terms, fieldsOf(p))) : items;

  const kind: Partial<Record<(typeof PACKAGE_KINDS)[number], number>> = {};
  for (const k of withTerms(applyFilters(allSummaries, query, "kind"))) {
    kind[k.kind] = (kind[k.kind] ?? 0) + 1;
  }

  const runtime: Partial<Record<(typeof RUNTIME_IDS)[number], number>> = {};
  for (const p of withTerms(applyFilters(allSummaries, query, "runtime"))) {
    for (const r of p.runtimes) runtime[r] = (runtime[r] ?? 0) + 1;
  }

  const priceItems = withTerms(applyFilters(allSummaries, query, "price"));
  const price = {
    free: priceItems.filter((p) => p.pricing.model === "free").length,
    paid: priceItems.filter((p) => p.pricing.model !== "free").length,
  };

  const tagCounts = new Map<string, number>();
  for (const p of withTerms(applyFilters(allSummaries, query, "tag"))) {
    for (const tag of p.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const tags = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 20);

  return { kind, runtime, price, tags };
}

async function get(owner: string, name: string): Promise<Package | null> {
  return loadAllPackages().find((p) => p.owner === owner && p.name === name) ?? null;
}

async function getFile(owner: string, name: string, filePath: string): Promise<PackageFile | null> {
  const pkg = await get(owner, name);
  if (!pkg) return null;

  const normalized = normalizeRelativePath(filePath);
  if (!normalized) return null;

  const allowed = new Set<string>([...pkg.manifest.files, "README.md", "openagent.yaml"]);
  if (!allowed.has(normalized)) return null;

  const pkgPath = path.join(CATALOG_ROOT, owner, name);
  const fullPath = path.join(pkgPath, normalized);

  const resolvedPkgPath = path.resolve(pkgPath);
  const resolvedFullPath = path.resolve(fullPath);
  if (resolvedFullPath !== resolvedPkgPath && !resolvedFullPath.startsWith(resolvedPkgPath + path.sep)) {
    return null; // escaped the package directory
  }

  if (!fs.existsSync(fullPath)) return null;
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) return null;

  // Read as bytes first (not "utf-8") so a binary asset (image, pdf, ...) is
  // sniffed correctly rather than mangled through a lossy text decode.
  const buf = fs.readFileSync(fullPath);
  const binary = isProbablyBinary(buf);
  return {
    path: normalized,
    size: stat.size,
    content: binary ? buf.toString("base64") : buf.toString("utf-8"),
    encoding: binary ? "base64" : "utf8",
    mode: seedFileMode(stat, normalized),
  };
}

async function creator(handle: string): Promise<Creator | null> {
  const packages = loadAllPackages().filter((p) => p.owner === handle);
  if (packages.length === 0) return null;

  const ownerInfo = readJsonSafe<OwnerFile>(path.join(CATALOG_ROOT, handle, "owner.json"));

  return {
    handle,
    displayName: ownerInfo?.displayName ?? handle,
    bio: ownerInfo?.bio,
    avatarUrl: ownerInfo?.avatarUrl,
    url: ownerInfo?.url,
    packageCount: packages.length,
  };
}

async function featured(limit: number = 6): Promise<PackageSummary[]> {
  const packages = loadAllPackages();
  const marked = packages.filter((p) => p.featured).map(toSummary);
  const pool = marked.length > 0 ? marked : packages.map(toSummary);
  return [...pool]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

async function tags(): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const pkg of loadAllPackages()) {
    for (const tag of pkg.manifest.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export const seedCatalog: Catalog = { list, get, getFile, creator, featured, tags, facets };

export default seedCatalog;
