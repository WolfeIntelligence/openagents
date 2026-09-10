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
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [unique("packages_owner_name_unique").on(t.owner, t.name)]
);

export const packageVersions = pgTable("package_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("packageId")
    .notNull()
    .references(() => packages.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  manifest: jsonb("manifest").notNull(),
  readme: text("readme").notNull().default(""),
  changelog: text("changelog"),
  publishedAt: timestamp("publishedAt", { mode: "date" }).notNull().defaultNow(),
});

export const packageFiles = pgTable("package_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  versionId: uuid("versionId")
    .notNull()
    .references(() => packageVersions.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  size: integer("size").notNull(),
  content: text("content").notNull(),
});

export const purchases = pgTable("purchases", {
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
  status: text("status").notNull().default("pending"), // pending | paid | failed | refunded
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

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
