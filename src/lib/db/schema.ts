// Drizzle Postgres schema for OpenAgents.
//
// Includes the Auth.js (@auth/drizzle-adapter) tables — users, accounts, sessions,
// verificationTokens — using the table/column names the adapter expects, plus
// OpenAgents-specific tables for packages, versions, files, purchases, and stars.
//
// This module has no side effects and requires no env vars to import.

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
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
    // Lifecycle: pending (awaiting review, owner-only) | live | unlisted (hidden from
    // listings/search, still installable by URL) | deprecated (listed with a banner).
    status: text("status").notNull().default("live"),
    deprecationMessage: text("deprecationMessage"),
    /** "owner/name" of the package that supersedes this one, when deprecated. */
    replacementId: text("replacementId"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [unique("packages_owner_name_unique").on(t.owner, t.name)]
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
    status: text("status").notNull().default("pending"), // pending | paid | failed | refunded
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  // One purchase row per Stripe Checkout Session: webhook redeliveries and the
  // success-page fallback both upsert against this rather than inserting twice.
  (t) => [unique("purchases_stripe_session_unique").on(t.stripeSessionId)]
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
  (t) => [primaryKey({ columns: [t.userId, t.owner, t.name] })]
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
  (t) => [unique("download_events_unique_per_day").on(t.owner, t.name, t.clientHash, t.day)]
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
  (t) => [unique("reviews_one_per_user_per_package").on(t.userId, t.owner, t.name)]
);
