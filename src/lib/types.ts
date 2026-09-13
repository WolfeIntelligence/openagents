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
  /** Billing period, only for `subscription` (default "month"). */
  interval?: "month" | "year";
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
  /** Short verb phrases naming what this package actually does, e.g.
   *  "reconcile csv", "review pull request" — matched by `q` in
   *  /api/v1/packages and /api/v1/search, alongside tags/title/summary/name.
   *  See CAPABILITY_RE in manifest.ts for the accepted format. */
  capabilities: string[];
  homepage?: string;
  repository?: string;
  /** Where this package's content originally came from, when it wasn't
   *  authored directly against this registry (e.g. the scout importing an
   *  existing skill and republishing it under `wolfe`). See ProvenanceEvidence. */
  origin?: ManifestOrigin;
  /** Supporting links for why this package is trustworthy/fit for purpose —
   *  a benchmark, a citation, a test run, the repo it was scanned from. */
  evidence?: ManifestEvidence[];
  /** Who (agent or person) actually ran the publish, distinct from `owner`
   *  (the package's identity) — e.g. a crew agent publishing under an
   *  organization it's a member of. */
  attestedBy?: ManifestAttestation;
}

export interface ManifestOrigin {
  /** Source repository, as "owner/repo" or a full URL — any git host, not
   *  just GitHub (contrast with the GitHub-only auto-sync in sources.ts). */
  repo: string;
  /** Commit sha (short or full hex) the published content was taken from. */
  commit: string;
}

export interface ManifestEvidence {
  url: string;
  /** Free-form, e.g. "repo", "benchmark", "citation", "test-run", "scan". */
  kind: string;
  note?: string;
}

export interface ManifestAttestation {
  /** Agent name (e.g. "scout", "wolfe-factory") or a person's handle. */
  name: string;
  /** Identifies the specific run that produced this publish, when the
   *  publisher is an automated agent (e.g. a WolfeOS factory run id). */
  runId?: string;
}

export interface PackageFile {
  path: string; // relative to package root
  size: number; // bytes (decoded size for binary files, not the base64 length)
  content?: string; // populated when explicitly requested; base64 when `encoding` is "base64"
  /** How `content` encodes the file's bytes. Absent means "utf8" — every file
   *  written before this field existed is implicitly text. */
  encoding?: "utf8" | "base64";
  /** POSIX file mode, e.g. 0o755 for an executable script. Absent means the
   *  default 0o644 (see MAX_BINARY_BYTES/isExecutableName in lib/files.ts for
   *  how this gets inferred when the source has no real mode bit). */
  mode?: number;
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
    /** Mean review rating (1..5); absent until the package has a review. */
    ratingAverage?: number;
    ratingCount?: number;
    /** Unique downloads in the last 7 days (G-S4) — only ever populated by
     *  `sortByTrending` in `catalog/db.ts` when `sort=trending` was actually
     *  requested; absent otherwise (never a made-up zero). See the merge (not
     *  replace) in `withStats`'s `decorate()` in `catalog/index.ts`, which is
     *  what keeps this from being clobbered by the downloads/stars decorator. */
    trending?: number;
  };
  featured: boolean;
  /** Whether `owner` is a user handle or an organization handle; absent means user. */
  ownerType?: "user" | "org";
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
  "id" | "owner" | "name" | "stats" | "featured" | "ownerType" | "status" | "deprecation" | "source" | "updatedAt"
> & {
  title: string;
  summary: string;
  kind: PackageKind;
  tags: string[];
  /** See `Manifest.capabilities`. */
  capabilities: string[];
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
  /** "trending" = unique downloads in the last 7 days (G-S4); zero DB support
   *  means zero events recorded, which degrades to "updated" ordering — see
   *  the comment on `sortByTrending` in `catalog/db.ts`. */
  sort?: "downloads" | "stars" | "updated" | "name" | "trending";
  limit?: number;
  offset?: number;
  /** Include pending/unlisted packages (owner and admin views). Listings default to
   *  live + deprecated only. */
  includeHidden?: boolean;
  /** Set from `?facets=1` — asks `Catalog.facets()` to be worth computing for
   *  this request. Parsed here (like every other query flag) even though only
   *  the `/api/v1/packages` route reads it, so there's one query-parsing entry
   *  point (see `parseCatalogQuery`). */
  facets?: boolean;
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
  /** Set only when the requested `q` had zero hits and a typo-tolerant retry
   *  (Damerau-Levenshtein distance <=1 against the catalog's own name/tag
   *  vocabulary) found a corrected query that did match — see `search.ts`'s
   *  `buildCorrectedQuery`. `items`/`total` above already reflect the
   *  corrected query; the UI shows "Showing results for {correctedQuery}". */
  correctedQuery?: string;
}

/** Facet counts for the *current* filtered query (G-S3) — computed the way
 *  e-commerce facets work: each dimension's own counts are computed as if
 *  that dimension's filter were removed (so picking "Free" doesn't collapse
 *  the "Paid" count to zero), while every *other* active filter still
 *  applies. `tags` is capped to the top 20 by count. */
export interface FacetCounts {
  kind: Partial<Record<PackageKind, number>>;
  runtime: Partial<Record<RuntimeId, number>>;
  price: { free: number; paid: number };
  tags: { tag: string; count: number }[];
}

export interface Catalog {
  list(query?: CatalogQuery): Promise<CatalogPage>;
  get(owner: string, name: string): Promise<Package | null>;
  getFile(owner: string, name: string, path: string): Promise<PackageFile | null>;
  creator(handle: string): Promise<Creator | null>;
  featured(limit?: number): Promise<PackageSummary[]>;
  tags(): Promise<{ tag: string; count: number }[]>;
  /** Optional: not every catalog implementation needs to support facets
   *  (see G-S3). Callers use `catalog.facets?.(query)`. */
  facets?(query?: CatalogQuery): Promise<FacetCounts>;
}

/**
 * One line of `GET /api/v1/catalog.ndjson` (bulk/incremental export): a
 * manifest summary plus the tarball's download sha256, so a mirror can verify
 * what it fetched without a second round trip to the download route. See
 * `src/lib/catalogExport.ts`.
 */
export interface CatalogExportEntry {
  id: string; // "owner/name"
  owner: string;
  name: string;
  kind: PackageKind;
  title: string;
  summary: string;
  version: string;
  license: string;
  tags: string[];
  capabilities: string[];
  runtimes: RuntimeId[];
  pricing: Pricing;
  updatedAt: string; // ISO
  /** Hex-encoded sha256 of the same gzip tarball `.../download` serves — see tarball.ts. */
  downloadSha256: string;
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
    capabilities: m.capabilities,
    runtimes: m.runtimes,
    pricing: m.pricing,
    version: m.version,
    license: m.license,
    stats: p.stats,
    featured: p.featured,
    ownerType: p.ownerType,
    status: p.status,
    deprecation: p.deprecation,
    source: p.source,
    updatedAt: p.updatedAt,
  };
}
