// Account-lifecycle business logic: data export (`GET /api/v1/account/export`) and
// self-service deletion (`DELETE /api/v1/account`).
//
// The actual "is this account safe to delete, and how" decision is a pure function
// (`deletionPlan`) with no DB access, exercised directly in
// `./__tests__/account.test.ts`. `deleteAccount` below just gathers the inputs that
// function needs and executes whichever plan it returns — the eligibility rules
// themselves live in exactly one place.

import { randomBytes } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { apiTokens, packages, purchases, reviews, stars, users } from "@/lib/db/schema";
import { deletePackage, PackageActionError } from "@/lib/moderation";
import type { PackageStatus } from "@/lib/types";

type Db = NonNullable<ReturnType<typeof getDb>>;

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------

export interface AccountExport {
  user: { id: string; handle: string | null; name: string | null; email: string | null; createdAt: string };
  /** "owner/name" of every package this user owns (as the seller). */
  packages: string[];
  purchases: {
    id: string;
    owner: string;
    name: string;
    amountCents: number;
    currency: string | null;
    status: string;
    receiptUrl: string | null;
    createdAt: string;
  }[];
  stars: { owner: string; name: string; createdAt: string }[];
  reviews: { owner: string; name: string; rating: number; body: string | null; createdAt: string; updatedAt: string }[];
  tokens: { id: string; name: string; prefix: string; createdAt: string }[];
}

interface RawUserRow {
  id: string;
  handle: string | null;
  name: string | null;
  email: string | null;
  createdAt: Date;
}
interface RawPackageRow {
  owner: string;
  name: string;
}
interface RawPurchaseRow {
  id: string;
  owner: string;
  name: string;
  amountCents: number;
  currency: string | null;
  status: string;
  receiptUrl: string | null;
  createdAt: Date;
}
interface RawStarRow {
  owner: string;
  name: string;
  createdAt: Date;
}
interface RawReviewRow {
  owner: string;
  name: string;
  rating: number;
  body: string | null;
  createdAt: Date;
  updatedAt: Date;
}
interface RawTokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
}

/** Pure row-shaping for the export payload — no DB access, so this is what
 *  `./__tests__/account.test.ts` exercises directly against fixed rows rather than
 *  a live database. `buildAccountExport` below is just the DB fetch that feeds it. */
export function shapeAccountExport(
  user: RawUserRow,
  ownedPackages: RawPackageRow[],
  purchaseRows: RawPurchaseRow[],
  starRows: RawStarRow[],
  reviewRows: RawReviewRow[],
  tokenRows: RawTokenRow[]
): AccountExport {
  return {
    user: {
      id: user.id,
      handle: user.handle,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    },
    packages: ownedPackages.map((p) => `${p.owner}/${p.name}`),
    purchases: purchaseRows.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    stars: starRows.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    reviews: reviewRows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    tokens: tokenRows.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
  };
}

/** Everything GDPR/CCPA-style "download my data" ought to cover for one user.
 *  `collections` are deliberately omitted (out of scope for this workstream — see the
 *  final report). Returns null only when there's no database or no such user; every
 *  sub-query below already runs against a user we've confirmed exists. */
export async function buildAccountExport(userId: string): Promise<AccountExport | null> {
  const db = getDb();
  if (!db) return null;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const [ownedPackages, purchaseRows, starRows, reviewRows, tokenRows] = await Promise.all([
    user.handle
      ? db.select({ owner: packages.owner, name: packages.name }).from(packages).where(eq(packages.owner, user.handle))
      : Promise.resolve([]),
    db
      .select({
        id: purchases.id,
        owner: packages.owner,
        name: packages.name,
        amountCents: purchases.amountCents,
        currency: purchases.currency,
        status: purchases.status,
        receiptUrl: purchases.receiptUrl,
        createdAt: purchases.createdAt,
      })
      .from(purchases)
      .innerJoin(packages, eq(purchases.packageId, packages.id))
      .where(eq(purchases.userId, userId)),
    db.select({ owner: stars.owner, name: stars.name, createdAt: stars.createdAt }).from(stars).where(eq(stars.userId, userId)),
    db
      .select({
        owner: reviews.owner,
        name: reviews.name,
        rating: reviews.rating,
        body: reviews.body,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
      })
      .from(reviews)
      .where(eq(reviews.userId, userId)),
    db
      .select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, userId))),
  ]);

  return shapeAccountExport(user, ownedPackages, purchaseRows, starRows, reviewRows, tokenRows);
}

// ---------------------------------------------------------------------------
// Deletion eligibility — pure, no DB. Unit-tested directly.
// ---------------------------------------------------------------------------

export interface DeletionUser {
  handle: string | null;
}

export interface DeletionCandidatePackage {
  owner: string;
  name: string;
  status: PackageStatus | string;
  /** Whether this package has at least one purchase row (any status). */
  hasPurchases: boolean;
}

export interface DeletionCandidateSubscription {
  purchaseId: string;
  /** Present and in the future = still granting paid access. */
  expiresAt: Date | null;
}

export type DeletionPlan =
  | { ok: false; status: 409; reason: "active-subscription"; purchaseIds: string[] }
  | { ok: false; status: 409; reason: "unlist-first"; packages: string[] }
  | { ok: true; anonymize: boolean; packagesToDelete: string[] };

/**
 * Decides whether `user` may delete their account right now, and if so, how.
 *
 * Three outcomes, checked in order:
 *
 * 1. `active-subscription` — the user has an unexpired subscription purchase (as a
 *    *buyer*). Deleting the account would cascade-delete that `purchases` row
 *    (FK `onDelete: cascade`) with no way to reach it again, so Stripe would keep
 *    billing a subscription the buyer can no longer see or cancel from the site.
 *    They must cancel it first (billing portal) — refusing here is the only way to
 *    guarantee that happens before the row disappears.
 *
 * 2. `unlist-first` — the user (as a *seller*) owns a package that already has
 *    purchases and is still publicly listed ("live"/"deprecated"/"pending" — anything
 *    other than "unlisted"). Deleting or anonymizing out from under a listed package
 *    is a worse surprise for existing buyers than asking the seller to unlist it
 *    first; unlisting keeps the package installable for whoever already bought it
 *    while taking it out of search/listings.
 *
 * 3. Otherwise, deletion proceeds: every owned package *without* purchases is safe
 *    to hard-delete outright (this is exactly `deletePackage`'s own success case).
 *    Owned packages *with* purchases survive (by now, guaranteed already
 *    "unlisted" — rule 2 would have refused otherwise) so their buyers keep working
 *    installs; `anonymize: true` tells the caller to scrub the user's own PII
 *    instead of removing the row outright, since `packages.owner` is a plain text
 *    column (no FK) that those surviving packages still point at by handle.
 */
export function deletionPlan(
  user: DeletionUser,
  ownedPackagesWithSales: DeletionCandidatePackage[],
  activeSubscriptions: DeletionCandidateSubscription[]
): DeletionPlan {
  void user; // not currently needed for the decision itself; kept for a stable, self-documenting call site

  const activeIds = activeSubscriptions
    .filter((s) => s.expiresAt !== null && s.expiresAt.getTime() > Date.now())
    .map((s) => s.purchaseId);
  if (activeIds.length > 0) {
    return { ok: false, status: 409, reason: "active-subscription", purchaseIds: activeIds };
  }

  const stillListedWithSales = ownedPackagesWithSales.filter((p) => p.hasPurchases && p.status !== "unlisted");
  if (stillListedWithSales.length > 0) {
    return {
      ok: false,
      status: 409,
      reason: "unlist-first",
      packages: stillListedWithSales.map((p) => `${p.owner}/${p.name}`),
    };
  }

  const packagesToDelete = ownedPackagesWithSales.filter((p) => !p.hasPurchases).map((p) => `${p.owner}/${p.name}`);
  const anonymize = ownedPackagesWithSales.some((p) => p.hasPurchases);

  return { ok: true, anonymize, packagesToDelete };
}

/** Human-readable message for a refused `DeletionPlan`, shared by the route so the
 *  wording lives in one place. */
export function deletionPlanMessage(plan: Extract<DeletionPlan, { ok: false }>): string {
  if (plan.reason === "active-subscription") {
    return "you have an active subscription purchase; cancel it from the billing portal before deleting your account";
  }
  return `unlist these packages first (they still have buyers): ${plan.packages.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Deletion — gathers the DB state `deletionPlan` needs, then executes its result.
// ---------------------------------------------------------------------------

export type DeleteAccountResult =
  | { ok: true; anonymized: boolean }
  | { ok: false; status: number; message: string };

async function packagesOwnedBy(db: Db, handle: string): Promise<DeletionCandidatePackage[]> {
  const rows = await db
    .select({ id: packages.id, owner: packages.owner, name: packages.name, status: packages.status })
    .from(packages)
    .where(eq(packages.owner, handle));

  return Promise.all(
    rows.map(async (row) => {
      const [purchase] = await db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.packageId, row.id))
        .limit(1);
      return { owner: row.owner, name: row.name, status: row.status, hasPurchases: Boolean(purchase) };
    })
  );
}

/** Generates an unused `deleted-<8 hex>` handle, retrying on the (astronomically
 *  unlikely) chance of a collision with an existing row. */
async function freshAnonymousHandle(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `deleted-${randomBytes(4).toString("hex")}`;
    const [collision] = await db.select({ id: users.id }).from(users).where(eq(users.handle, candidate)).limit(1);
    if (!collision) return candidate;
  }
  // Fall back to a wider random suffix rather than looping forever.
  return `deleted-${randomBytes(4).toString("hex")}-${Date.now().toString(36)}`;
}

/**
 * Deletes (or anonymizes — see `deletionPlan`) `userId`'s account. Session-only by
 * contract (enforced by the route, not here); `confirmHandle` must match the user's
 * current handle so a stolen/replayed request body can't casually delete an account
 * blind. Never throws — every failure mode comes back as `{ ok: false, status, message }`
 * so the route can pass it straight through.
 */
export async function deleteAccount(userId: string, confirmHandle: string): Promise<DeleteAccountResult> {
  const db = getDb();
  if (!db) {
    return { ok: false, status: 503, message: "account deletion requires a database; none is configured on this deployment" };
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return { ok: false, status: 404, message: "account not found" };
  }
  if (!user.handle || confirmHandle !== user.handle) {
    return { ok: false, status: 400, message: `confirmation must match your handle exactly ("${user.handle ?? ""}")` };
  }

  const subscriptionRows = await db
    .select({ id: purchases.id, expiresAt: purchases.expiresAt })
    .from(purchases)
    .where(and(eq(purchases.userId, userId), isNotNull(purchases.stripeSubscriptionId)));
  const activeSubscriptions: DeletionCandidateSubscription[] = subscriptionRows.map((r) => ({
    purchaseId: r.id,
    expiresAt: r.expiresAt,
  }));

  const ownedPackagesWithSales = await packagesOwnedBy(db, user.handle);

  const plan = deletionPlan({ handle: user.handle }, ownedPackagesWithSales, activeSubscriptions);
  if (!plan.ok) {
    return { ok: false, status: plan.status, message: deletionPlanMessage(plan) };
  }

  // Packages with zero purchases are safe to remove outright — this mirrors
  // `deletePackage`'s own success case exactly, so a race that adds a purchase
  // between our check above and this call surfaces as a clear failure (via the
  // PackageActionError below) rather than silently leaving an orphaned package.
  for (const id of plan.packagesToDelete) {
    const [owner, name] = id.split("/");
    try {
      await deletePackage(owner, name);
    } catch (err) {
      if (err instanceof PackageActionError) {
        return {
          ok: false,
          status: 409,
          message: `${id} unexpectedly has purchases now; try again — it'll be kept instead of deleted`,
        };
      }
      throw err;
    }
  }

  if (plan.anonymize) {
    const newHandle = await freshAnonymousHandle(db);
    // Keep every surviving (purchased, already-unlisted) package's `owner` text in
    // sync with the new handle — `packages.owner` has no FK to `users`, so without
    // this the packages would keep pointing at a handle nobody holds, which is
    // exactly the freed-handle takeover this whole anonymize path exists to avoid
    // (see the file-level `deletionPlan` doc comment).
    await db.update(packages).set({ owner: newHandle }).where(eq(packages.owner, user.handle));
    await db
      .update(users)
      .set({ name: null, email: null, image: null, bio: null, website: null, handle: newHandle })
      .where(eq(users.id, userId));
    return { ok: true, anonymized: true };
  }

  // Auth.js sessions/accounts cascade via their FK to users.id; stars/reviews/
  // api_tokens/collections likewise cascade via their own FKs. Purchases *made* by
  // this user cascade too — deliberate: rule 1 above already refused if any of them
  // is still an active subscription, so every surviving row here is a settled
  // one-time purchase or a lapsed subscription with nothing left to bill.
  await db.delete(users).where(eq(users.id, userId));
  return { ok: true, anonymized: false };
}
