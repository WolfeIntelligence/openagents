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
import { parseManifest, validateManifestFiles } from "@/lib/manifest";
import {
  toSummary,
  type Catalog,
  type CatalogPage,
  type CatalogQuery,
  type Creator,
  type Package,
  type PackageFile,
  type PackageSummary,
} from "@/lib/types";

const CATALOG_ROOT = path.join(process.cwd(), "catalog");
const BUILD_TIME = new Date().toISOString();

interface StatsFile {
  downloads?: number;
  stars?: number;
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
    return { path: f, size: stat.size };
  });

  const stats = readJsonSafe<StatsFile>(path.join(pkgPath, ".stats.json")) ?? {};

  // Deployed bundles (e.g. Vercel) normalize file mtimes to a bogus epoch, so
  // prefer explicit dates from .stats.json and fall back to build time when the
  // filesystem dates look fake.
  const buildTime = BUILD_TIME;
  const plausible = (ms: number) => ms > Date.UTC(2020, 0, 1);
  const createdAt =
    stats.createdAt ??
    (plausible(Math.min(...mtimes)) ? new Date(Math.min(...mtimes)).toISOString() : buildTime);
  const updatedAt =
    stats.updatedAt ??
    (plausible(Math.max(...mtimes)) ? new Date(Math.max(...mtimes)).toISOString() : buildTime);

  const pkg: Package = {
    id: `${owner}/${name}`,
    owner,
    name,
    manifest,
    readme,
    files,
    versions: [{ version: manifest.version, publishedAt: updatedAt }],
    stats: {
      downloads: stats.downloads ?? 0,
      stars: stats.stars ?? 0,
    },
    featured: stats.featured ?? false,
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

async function list(query: CatalogQuery = {}): Promise<CatalogPage> {
  const packages = loadAllPackages();
  let items: PackageSummary[] = packages.map(toSummary);

  if (query.q) {
    const q = query.q.toLowerCase();
    items = items.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.owner.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }
  if (query.kind) items = items.filter((p) => p.kind === query.kind);
  if (query.runtime) items = items.filter((p) => p.runtimes.includes(query.runtime!));
  if (query.price === "free") items = items.filter((p) => p.pricing.model === "free");
  if (query.price === "paid") items = items.filter((p) => p.pricing.model !== "free");
  if (query.tag) items = items.filter((p) => p.tags.includes(query.tag!));
  if (query.owner) items = items.filter((p) => p.owner === query.owner);

  const sort = query.sort ?? "downloads";
  const sorted = [...items].sort((a, b) => {
    switch (sort) {
      case "stars":
        return b.stats.stars - a.stats.stars;
      case "updated":
        return b.updatedAt.localeCompare(a.updatedAt);
      case "name":
        return a.name.localeCompare(b.name);
      case "downloads":
      default:
        return b.stats.downloads - a.stats.downloads;
    }
  });

  const total = sorted.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 24;
  const page = sorted.slice(offset, offset + limit);
  return { items: page, total };
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

  const content = fs.readFileSync(fullPath, "utf-8");
  return { path: normalized, size: stat.size, content };
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
  return [...pool].sort((a, b) => b.stats.downloads - a.stats.downloads).slice(0, limit);
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

export const seedCatalog: Catalog = { list, get, getFile, creator, featured, tags };

export default seedCatalog;
