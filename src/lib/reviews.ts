// Reviews and ratings for packages (G-R2).
//
// One review per (user, package), enforced by `reviews_one_per_user_per_package`
// — writing twice is an upsert, never a second row. `package_stats.ratingSum` /
// `ratingCount` are always *recounted* from the `reviews` table after a write,
// the same way `toggleStar` recounts `stars` — derived state can never drift
// out of sync with the rows that back it, even under a retried or racing write.
//
// Safe to import with zero env vars: every DB-backed export no-ops (or reports
// "unavailable") when DATABASE_URL is unset, matching `./stats`.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packages, packageStats, purchases, reviews, users } from "@/lib/db/schema";
import { hasPurchased } from "@/lib/purchases";

export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MAX_REVIEW_BODY_LENGTH = 2000;
export const DEFAULT_REVIEWS_PAGE_SIZE = 20;
export const MAX_REVIEWS_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Pure helpers — no DB access, safe to unit test directly.
// ---------------------------------------------------------------------------

/** True when `value` is a whole-number rating in [1, 5] — the only shape the
 *  `reviews.rating` column and the review form ever accept. */
export function isValidRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RATING &&
    value <= MAX_RATING
  );
}

/** True when `value` is absent, or a string within the length cap. Empty/whitespace-only
 *  text is allowed here — callers normalize that to `null` before writing. */
export function isValidReviewBody(value: unknown): value is string | undefined {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.length <= MAX_REVIEW_BODY_LENGTH;
}

/** Mean of `sum/count`, or `undefined` when nobody has rated yet — matches
 *  `Stats.ratingAverage`'s "absent until reviewed" contract (never `NaN`/`0`). */
export function computeAverage(sum: number, count: number): number | undefined {
  return count > 0 ? sum / count : undefined;
}

/** Clamps a client-supplied `limit` into `[1, MAX_REVIEWS_PAGE_SIZE]`, defaulting
 *  when absent or not a finite number. */
export function clampReviewsLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_REVIEWS_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(n), 1), MAX_REVIEWS_PAGE_SIZE);
}

/** Clamps a client-supplied `offset` into `[0, +Infinity)`, defaulting to 0. */
export function clampReviewsOffset(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// ---------------------------------------------------------------------------
// DB-backed reads and writes.
// ---------------------------------------------------------------------------

export interface ReviewAuthor {
  handle: string | null;
  name: string | null;
  image: string | null;
}

export interface ReviewItem {
  id: string;
  user: ReviewAuthor;
  rating: number;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  /** A `paid` purchase row exists for this user and package. Always false for a
   *  free package (nobody has a purchase row for one) or when the DB is off. */
  verifiedPurchase: boolean;
}

export interface ReviewsPage {
  items: ReviewItem[];
  average: number | undefined;
  count: number;
}

const EMPTY_PAGE: ReviewsPage = { items: [], average: undefined, count: 0 };

/** Recounts `package_stats.ratingSum`/`ratingCount` for one package straight from
 *  the `reviews` table, then upserts the result — same pattern as `toggleStar`'s
 *  star recount in `./stats`. Never throws; a failure here must not fail the
 *  review write that triggered it. */
async function recalcRatingStats(owner: string, name: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const [agg] = await db
      .select({
        count: sql<number>`count(*)::int`,
        sum: sql<number>`coalesce(sum(${reviews.rating}), 0)::int`,
      })
      .from(reviews)
      .where(and(eq(reviews.owner, owner), eq(reviews.name, name)));

    await db
      .insert(packageStats)
      .values({
        owner,
        name,
        downloads: 0,
        stars: 0,
        ratingCount: agg?.count ?? 0,
        ratingSum: agg?.sum ?? 0,
      })
      .onConflictDoUpdate({
        target: [packageStats.owner, packageStats.name],
        set: { ratingCount: agg?.count ?? 0, ratingSum: agg?.sum ?? 0 },
      });
  } catch {
    // Best-effort — the review write itself already succeeded or failed on its
    // own terms; a stats recount hiccup shouldn't turn that into an error too.
  }
}

/**
 * Reviews for one package, newest first, plus the live average/count (computed
 * from every review, not just the page returned). Returns an empty page when the
 * DB is off or on any query failure — a reviews outage should never take down
 * the package page that embeds it.
 */
export async function getReviewsPage(
  owner: string,
  name: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<ReviewsPage> {
  const db = getDb();
  if (!db) return EMPTY_PAGE;

  const limit = clampReviewsLimit(opts.limit);
  const offset = clampReviewsOffset(opts.offset);

  try {
    const [rows, [agg], [pkg]] = await Promise.all([
      db
        .select({
          id: reviews.id,
          userId: reviews.userId,
          rating: reviews.rating,
          body: reviews.body,
          createdAt: reviews.createdAt,
          updatedAt: reviews.updatedAt,
          handle: users.handle,
          name: users.name,
          image: users.image,
        })
        .from(reviews)
        .innerJoin(users, eq(reviews.userId, users.id))
        .where(and(eq(reviews.owner, owner), eq(reviews.name, name)))
        .orderBy(desc(reviews.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({
          count: sql<number>`count(*)::int`,
          sum: sql<number>`coalesce(sum(${reviews.rating}), 0)::int`,
        })
        .from(reviews)
        .where(and(eq(reviews.owner, owner), eq(reviews.name, name))),
      db
        .select({ id: packages.id })
        .from(packages)
        .where(and(eq(packages.owner, owner), eq(packages.name, name)))
        .limit(1),
    ]);

    // One purchases query for the whole page rather than one per review row.
    const userIds = rows.map((r) => r.userId);
    let verified = new Set<string>();
    if (pkg && userIds.length > 0) {
      const purchasedRows = await db
        .select({ userId: purchases.userId })
        .from(purchases)
        .where(
          and(
            eq(purchases.packageId, pkg.id),
            eq(purchases.status, "paid"),
            inArray(purchases.userId, userIds)
          )
        );
      verified = new Set(purchasedRows.map((p) => p.userId));
    }

    const count = agg?.count ?? 0;
    return {
      items: rows.map((r) => ({
        id: r.id,
        user: { handle: r.handle, name: r.name, image: r.image },
        rating: r.rating,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        verifiedPurchase: verified.has(r.userId),
      })),
      average: computeAverage(agg?.sum ?? 0, count),
      count,
    };
  } catch {
    return EMPTY_PAGE;
  }
}

/** This user's own review of this package, or null if they haven't reviewed it
 *  (or the DB is off). Used to pre-fill the review form. */
export async function getOwnReview(
  userId: string,
  owner: string,
  name: string
): Promise<{ rating: number; body: string | null } | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select({ rating: reviews.rating, body: reviews.body })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.owner, owner), eq(reviews.name, name)))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

export type ReviewWriteResult =
  | { ok: true; review: ReviewItem; average: number | undefined; count: number }
  | { ok: false; status: number; message: string };

/**
 * Creates or updates the caller's review of `owner/name`. Owners can't review
 * their own package (403). Recounts `package_stats` afterward so the average
 * shown everywhere else is immediately consistent with this write.
 */
export async function upsertReview(
  userId: string,
  owner: string,
  name: string,
  input: { rating: number; body?: string }
): Promise<ReviewWriteResult> {
  const db = getDb();
  if (!db) {
    return { ok: false, status: 503, message: "reviews require a database; none is configured on this deployment" };
  }
  if (!isValidRating(input.rating)) {
    return { ok: false, status: 400, message: "rating must be a whole number from 1 to 5" };
  }
  if (!isValidReviewBody(input.body)) {
    return { ok: false, status: 400, message: `review text must be ${MAX_REVIEW_BODY_LENGTH} characters or fewer` };
  }

  try {
    const [caller] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1);
    if (caller?.handle && caller.handle === owner) {
      return { ok: false, status: 403, message: "you can't review your own package" };
    }

    const body = input.body?.trim() ? input.body.trim() : null;
    const now = new Date();

    await db
      .insert(reviews)
      .values({ userId, owner, name, rating: input.rating, body, updatedAt: now })
      .onConflictDoUpdate({
        target: [reviews.userId, reviews.owner, reviews.name],
        set: { rating: input.rating, body, updatedAt: now },
      });

    await recalcRatingStats(owner, name);

    const [row] = await db
      .select({
        id: reviews.id,
        userId: reviews.userId,
        rating: reviews.rating,
        body: reviews.body,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        handle: users.handle,
        name: users.name,
        image: users.image,
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.userId, users.id))
      .where(and(eq(reviews.userId, userId), eq(reviews.owner, owner), eq(reviews.name, name)))
      .limit(1);

    if (!row) {
      return { ok: false, status: 500, message: "review write did not persist" };
    }

    const [agg] = await db
      .select({
        count: sql<number>`count(*)::int`,
        sum: sql<number>`coalesce(sum(${reviews.rating}), 0)::int`,
      })
      .from(reviews)
      .where(and(eq(reviews.owner, owner), eq(reviews.name, name)));
    const count = agg?.count ?? 0;
    const verifiedPurchase = await hasPurchased(userId, owner, name);

    return {
      ok: true,
      review: {
        id: row.id,
        user: { handle: row.handle, name: row.name, image: row.image },
        rating: row.rating,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        verifiedPurchase,
      },
      average: computeAverage(agg?.sum ?? 0, count),
      count,
    };
  } catch {
    return { ok: false, status: 500, message: "failed to save review" };
  }
}

export type ReviewDeleteResult = { ok: true } | { ok: false; status: number; message: string };

/** Deletes the caller's own review of `owner/name`, then recounts `package_stats`.
 *  Idempotent: deleting a review that doesn't exist still reports success. */
export async function deleteReview(userId: string, owner: string, name: string): Promise<ReviewDeleteResult> {
  const db = getDb();
  if (!db) {
    return { ok: false, status: 503, message: "reviews require a database; none is configured on this deployment" };
  }
  try {
    await db
      .delete(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.owner, owner), eq(reviews.name, name)));
    await recalcRatingStats(owner, name);
    return { ok: true };
  } catch {
    return { ok: false, status: 500, message: "failed to delete review" };
  }
}
