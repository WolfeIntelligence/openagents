// Drizzle Postgres schema for OpenAgents.
//
// Includes the Auth.js (@auth/drizzle-adapter) tables — users, accounts, sessions,
// verificationTokens — using the table/column names the adapter expects, plus
// OpenAgents-specific tables for packages, versions, files, purchases, and stars.
//
// This module has no side effects and requires no env vars to import.

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---------------------------------------------------------------------------
// Auth.js adapter tables (schema/names per @auth/drizzle-adapter docs)
// ---------------------------------------------------------------------------

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),

  // OpenAgents extensions
  handle: text("handle").unique(),
  bio: text("bio"),
  stripeAccountId: text("stripeAccountId"),
  stripeOnboarded: boolean("stripeOnboarded").notNull().default(false),
  /** Stripe Customer used for the buyer side (subscriptions, billing portal). */
  stripeCustomerId: text("stripeCustomerId"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  website: text("website"),
  // Moderation role. Granted by hand (or via ADMIN_HANDLES env) — there is no UI to grant it.
  isAdmin: boolean("isAdmin").notNull().default(false),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// ---------------------------------------------------------------------------
// OpenAgents domain tables
// ---------------------------------------------------------------------------

/**
 * The exact full-text-search expression indexed by `packages_fts_idx` below.
 *
 * Defined as a function of the four/five columns it touches (rather than a
 * plain `sql` constant closing over the `packages` table) so it can be built
 * twice from the *same source* without a circular import: once here, inside
 * `packages`'s own index list — where `packages` doesn't exist as a value
 * yet, only `t` (the table being defined) does — and once from
 * `src/lib/catalog/db.ts`'s search query, called as
 * `packagesFtsExpression(packages)` after the table is fully defined. Postgres
 * can only use a functional GIN index when the query expression matches the
 * indexed expression byte-for-byte, so this function is the single source of
 * truth for both sides; never inline this expression again elsewhere.
 *
 * Tags are folded in as the jsonb's text form (`["a","b"]`) rather than via a
 * `jsonb_array_elements_text` subquery: index expressions must be immutable and
 * may not contain subqueries, and `to_tsvector` drops the brackets and quotes
 * anyway, so the tokens are the same.
 */
export function packagesFtsExpression(t: {
  title: PgColumn;
  summary: PgColumn;
  name: PgColumn;
  owner: PgColumn;
  tags: PgColumn;
}) {
  return sql`to_tsvector('english',
      coalesce(${t.title}, '') || ' ' ||
      coalesce(${t.summary}, '') || ' ' ||
      ${t.name} || ' ' ||
      ${t.owner} || ' ' ||
      coalesce(${t.tags}::text, '')
    )`;
}

export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(), // creator handle
    name: text("name").notNull(),
    kind: text("kind").notNull(), // PackageKind
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    license: text("license").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    runtimes: jsonb("runtimes").$type<string[]>().notNull().default([]),
    pricingModel: text("pricingModel").notNull(), // PricingModel
    amountCents: integer("amountCents").notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    entry: text("entry").notNull(),
    featured: boolean("featured").notNull().default(false),
    latestVersion: text("latestVersion").notNull(),
    /** Whether `owner` names a user handle or an organization handle. */
    ownerType: text("ownerType").notNull().default("user"), // user | org
    // Lifecycle: pending (awaiting review, owner-only) | live | unlisted (hidden from
    // listings/search, still installable by URL) | deprecated (listed with a banner).
    status: text("status").notNull().default("live"),
    deprecationMessage: text("deprecationMessage"),
    /** "owner/name" of the package that supersedes this one, when deprecated. */
    replacementId: text("replacementId"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("packages_owner_name_unique").on(t.owner, t.name),
    // G-O5 / GIN index for full-text search: indexes the exact expression
    // catalog/db.ts's `tsMatchCondition` matches against (via the shared
    // `packagesFtsExpression` above), so the planner can use this index
    // instead of computing `to_tsvector` per row on every search.
    index("packages_fts_idx").using("gin", packagesFtsExpression(t)),
    // Owner-scoped listings (creator pages, `?owner=`, facet dimension skips)
    // and the admin/moderation status filter are both common enough to want
    // their own btree index rather than relying on the (owner, name) unique
    // index's leading column alone.
    index("packages_owner_idx").on(t.owner),
    index("packages_status_idx").on(t.status),
  ]
);

export const packageVersions = pgTable(
  "package_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("packageId")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    manifest: jsonb("manifest").notNull(),
    readme: text("readme").notNull().default(""),
    changelog: text("changelog"),
    /** Publish-time content scan: 0 (clean) .. 100, and the matched rule ids. */
    riskScore: integer("riskScore").notNull().default(0),
    scanFlags: jsonb("scanFlags").$type<string[]>().notNull().default([]),
    publishedAt: timestamp("publishedAt", { mode: "date" }).notNull().defaultNow(),
  },
  // A version is immutable once published: the same version string can never be
  // inserted twice for one package (publishing enforces semver ordering on top).
  (t) => [unique("package_versions_package_version_unique").on(t.packageId, t.version)]
);

export const packageFiles = pgTable("package_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  versionId: uuid("versionId")
    .notNull()
    .references(() => packageVersions.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  size: integer("size").notNull(),
  content: text("content").notNull(),
  /** "utf8" for text (content is the text) or "base64" for binary (content is base64). */
  encoding: text("encoding").notNull().default("utf8"),
  /** POSIX file mode (e.g. 0o755 for executable scripts); null = default 0o644. */
  mode: integer("mode"),
});

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageId: uuid("packageId")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    stripeSessionId: text("stripeSessionId"),
    stripePaymentIntent: text("stripePaymentIntent"),
    amountCents: integer("amountCents").notNull(),
    // ISO 4217 lowercase, as charged. Nullable only for rows written before the
    // column existed; readers fall back to the package's current currency.
    currency: text("currency"),
    /** Stripe-hosted receipt for the charge, when the webhook could resolve one. */
    receiptUrl: text("receiptUrl"),
    /** Subscription purchases: the Stripe Subscription and when paid-through access ends
     *  (null = perpetual one-time purchase). */
    stripeSubscriptionId: text("stripeSubscriptionId"),
    expiresAt: timestamp("expiresAt", { mode: "date" }),
    status: text("status").notNull().default("pending"), // pending | paid | failed | refunded
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // One purchase row per Stripe Checkout Session: webhook redeliveries and the
    // success-page fallback both upsert against this rather than inserting twice.
    unique("purchases_stripe_session_unique").on(t.stripeSessionId),
    // "my purchases" / entitlement checks look up by (user, package); the
    // webhook and success-page fallback look up by payment intent.
    index("purchases_user_package_idx").on(t.userId, t.packageId),
    index("purchases_payment_intent_idx").on(t.stripePaymentIntent),
  ]
);

// ---------------------------------------------------------------------------
// Real usage counters
//
// Keyed by (owner, name) as text rather than by packages.id, because most of the
// catalog is seed packages that live on disk under catalog/<owner>/<name>/ and
// have no row in `packages`. One table covers both sources, so a package keeps
// its counts if it later moves from the seed catalog into the database.
//
// Every number here is something that actually happened: a download served, or a
// signed-in user pressing the star button. Nothing seeds or backfills them.
// ---------------------------------------------------------------------------

export const packageStats = pgTable(
  "package_stats",
  {
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    downloads: integer("downloads").notNull().default(0),
    stars: integer("stars").notNull().default(0),
    // Derived from `reviews` (recounted on every write), never incremented.
    ratingCount: integer("ratingCount").notNull().default(0),
    /** Sum of all ratings; average = ratingSum / ratingCount. */
    ratingSum: integer("ratingSum").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.owner, t.name] })]
);

export const stars = pgTable(
  "stars",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.owner, t.name] }),
    // Star counts/toggles are looked up by (owner, name) across all users, not
    // just by the (userId, owner, name) primary key's leading column.
    index("stars_owner_name_idx").on(t.owner, t.name),
  ]
);

// ---------------------------------------------------------------------------
// Batch-2 tables: API tokens, install analytics, moderation, reviews.
// ---------------------------------------------------------------------------

/** Personal access tokens for the CLI and API. Only the SHA-256 hash is stored;
 *  `prefix` (first 8 chars) is shown in the UI so a user can tell tokens apart. */
export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("tokenHash").notNull().unique(),
  prefix: text("prefix").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  lastUsedAt: timestamp("lastUsedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  revokedAt: timestamp("revokedAt", { mode: "date" }),
});

/** One row per download that counted: (package, hashed client, UTC day) is unique,
 *  so repeated installs from one machine in a day count once. Keyed by owner/name
 *  text like package_stats so seed packages are covered too. */
export const downloadEvents = pgTable(
  "download_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    runtime: text("runtime"),
    /** SHA-256 of client IP + a daily salt; never the raw address. */
    clientHash: text("clientHash").notNull(),
    /** YYYY-MM-DD in UTC. */
    day: text("day").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("download_events_unique_per_day").on(t.owner, t.name, t.clientHash, t.day),
    // Backs the trending query (`sortByTrending` in catalog/db.ts), which
    // groups by (owner, name) over a `day >=` window.
    index("download_events_owner_name_day_idx").on(t.owner, t.name, t.day),
  ]
);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  reporterUserId: text("reporterUserId").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull(), // prompt-injection | malware | license | spam | other
  details: text("details"),
  status: text("status").notNull().default("open"), // open | resolved | dismissed
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    rating: integer("rating").notNull(), // 1..5
    body: text("body"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("reviews_one_per_user_per_package").on(t.userId, t.owner, t.name),
    // Package detail pages list all reviews for one (owner, name).
    index("reviews_owner_name_idx").on(t.owner, t.name),
  ]
);

// ---------------------------------------------------------------------------
// Batch-3 tables: durable rate limits, collections, GitHub package sources.
// ---------------------------------------------------------------------------

/** Fixed-window counters shared by every serverless instance. `key` is
 *  "<route>:<client>" and `windowStart` the start of the current window. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("windowStart", { mode: "date" }).notNull().defaultNow(),
});

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("ownerUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Owner's handle at creation time; used in the URL /c/<handle>/<slug>. */
    ownerHandle: text("ownerHandle").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    isPublic: boolean("isPublic").notNull().default(true),
    featured: boolean("featured").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [unique("collections_owner_slug_unique").on(t.ownerHandle, t.slug)]
);

export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: uuid("collectionId")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    note: text("note"),
    addedAt: timestamp("addedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.owner, t.name] })]
);

/** A package linked to a GitHub repository for automatic republishing. The seller
 *  pastes `<site>/api/webhooks/github/<id>` plus the secret into the repo's webhook
 *  settings; a release/tag push re-imports `subdir` at that ref. */
export const packageSources = pgTable(
  "package_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(), // "github-owner/repo"
    ref: text("ref"), // branch or tag pattern; null = the pushed tag / default branch
    subdir: text("subdir"),
    secretHash: text("secretHash").notNull(),
    lastSyncedAt: timestamp("lastSyncedAt", { mode: "date" }),
    lastResult: text("lastResult"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [unique("package_sources_package_unique").on(t.owner, t.name)]
);

// ---------------------------------------------------------------------------
// Batch-4 tables: organizations, security advisories, refund requests, rollups.
// ---------------------------------------------------------------------------

/** A shared publisher identity. `handle` shares the namespace with user handles
 *  (packages.owner is a handle either way; `packages.ownerType` says which). */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").notNull().unique(),
  displayName: text("displayName").notNull(),
  bio: text("bio"),
  website: text("website"),
  avatarUrl: text("avatarUrl"),
  createdByUserId: text("createdByUserId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    orgId: uuid("orgId")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner | admin | member
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })]
);

/** Admin-posted security advisories. Shown on the package page, in the API, and
 *  by the CLI at install time while not withdrawn. */
export const advisories = pgTable("advisories", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  severity: text("severity").notNull(), // low | moderate | high | critical
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** semver range of affected versions, e.g. "<1.3.0"; null = all. */
  affectedVersions: text("affectedVersions"),
  fixedInVersion: text("fixedInVersion"),
  createdByUserId: text("createdByUserId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawnAt", { mode: "date" }),
});

export const refundRequests = pgTable("refund_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseId: uuid("purchaseId")
    .notNull()
    .references(() => purchases.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // open | approved | denied | refunded
  sellerNote: text("sellerNote"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  resolvedAt: timestamp("resolvedAt", { mode: "date" }),
});

/** Daily aggregates of download_events, written by the nightly cron so dashboards
 *  and trending sorts stop scanning raw events as they grow. */
export const downloadRollups = pgTable(
  "download_rollups",
  {
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD UTC
    count: integer("count").notNull().default(0),
    byRuntime: jsonb("byRuntime").$type<Record<string, number>>().notNull().default({}),
    byVersion: jsonb("byVersion").$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.owner, t.name, t.day] })]
);
