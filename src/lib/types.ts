// Authoritative domain types for OpenAgents. Do not redefine these elsewhere.

export const PACKAGE_KINDS = ["workflow", "harness", "rules", "skill"] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];

export const RUNTIME_IDS = [
  "claude-code",
  "cursor",
  "codex",
  "openai-agents",
  "langgraph",
  "generic",
] as const;
export type RuntimeId = (typeof RUNTIME_IDS)[number];

export const PRICING_MODELS = ["free", "one-time", "subscription"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export interface Pricing {
  model: PricingModel;
  amountCents: number; // 0 when free
  currency: string; // ISO 4217 lowercase, e.g. "usd"
}

export interface PackageInput {
  name: string;
  type: "string" | "number" | "boolean" | "path" | "url";
  required: boolean;
  description?: string;
  default?: string | number | boolean;
}

/** Parsed, validated contents of openagent.yaml */
export interface Manifest {
  schema: 1;
  name: string;
  owner: string;
  version: string;
  kind: PackageKind;
  title: string;
  summary: string;
  license: string;
  tags: string[];
  runtimes: RuntimeId[];
  pricing: Pricing;
  entry: string;
  files: string[];
  inputs: PackageInput[];
  requires: string[]; // "owner/name@range"
  homepage?: string;
  repository?: string;
}

export interface PackageFile {
  path: string; // relative to package root
  size: number; // bytes
  content?: string; // populated when explicitly requested
}

export interface PackageVersion {
  version: string;
  publishedAt: string; // ISO
  changelog?: string;
}

/** A package as shown in listings and detail pages. */
export interface Package {
  id: string; // "owner/name"
  owner: string;
  name: string;
  manifest: Manifest;
  readme: string; // markdown
  files: PackageFile[];
  versions: PackageVersion[];
  stats: {
    downloads: number;
    stars: number;
  };
  featured: boolean;
  status: PackageStatus;
  /** Present when `status` is "deprecated". */
  deprecation?: { message?: string; replacementId?: string };
  source: "seed" | "db";
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Lightweight listing card. */
export type PackageSummary = Pick<
  Package,
  "id" | "owner" | "name" | "stats" | "featured" | "status" | "deprecation" | "source" | "updatedAt"
> & {
  title: string;
  summary: string;
  kind: PackageKind;
  tags: string[];
  runtimes: RuntimeId[];
  pricing: Pricing;
  version: string;
  license: string;
};

export interface Creator {
  handle: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  url?: string;
  packageCount: number;
}

export const PACKAGE_STATUSES = ["pending", "live", "unlisted", "deprecated"] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export interface CatalogQuery {
  q?: string;
  kind?: PackageKind;
  runtime?: RuntimeId;
  price?: "free" | "paid";
  tag?: string;
  owner?: string;
  sort?: "downloads" | "stars" | "updated" | "name";
  limit?: number;
  offset?: number;
  /** Include pending/unlisted packages (owner and admin views). Listings default to
   *  live + deprecated only. */
  includeHidden?: boolean;
}

/**
 * Ceiling for internal "fetch the whole filtered set" queries — merging the seed
 * and DB catalogs, or re-sorting by a real download/star count. Pass this rather
 * than leaving `limit` unset: an absent limit means "one default page" to the
 * seed catalog, which would silently drop everything past it.
 */
export const CATALOG_ALL_LIMIT = 10_000;

/** Default `limit` for a `CatalogQuery` when the caller (or the parsed query
 *  string) didn't specify one. Applied once in `parseCatalogQuery`, then
 *  respected — never re-defaulted — by every catalog layer. */
export const DEFAULT_PAGE_SIZE = 24;

/** Upper bound on a user-supplied `limit`. Only clamps values parsed from a
 *  query string (see `parseCatalogQuery`) — internal "everything" fetches pass
 *  `CATALOG_ALL_LIMIT` explicitly and are not subject to this cap. */
export const MAX_PAGE_SIZE = 100;

export interface CatalogPage {
  items: PackageSummary[];
  total: number;
}

export interface Catalog {
  list(query?: CatalogQuery): Promise<CatalogPage>;
  get(owner: string, name: string): Promise<Package | null>;
  getFile(owner: string, name: string, path: string): Promise<PackageFile | null>;
  creator(handle: string): Promise<Creator | null>;
  featured(limit?: number): Promise<PackageSummary[]>;
  tags(): Promise<{ tag: string; count: number }[]>;
}

export function toSummary(p: Package): PackageSummary {
  const m = p.manifest;
  return {
    id: p.id,
    owner: p.owner,
    name: p.name,
    title: m.title,
    summary: m.summary,
    kind: m.kind,
    tags: m.tags,
    runtimes: m.runtimes,
    pricing: m.pricing,
    version: m.version,
    license: m.license,
    stats: p.stats,
    featured: p.featured,
    status: p.status,
    deprecation: p.deprecation,
    source: p.source,
    updatedAt: p.updatedAt,
  };
}
