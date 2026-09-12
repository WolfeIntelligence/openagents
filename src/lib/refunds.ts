// Refund requests (Z4 buyer trust): a buyer asks for a refund on a one-time
// purchase, the seller (or an admin) approves or denies it. Approving issues
// the actual Stripe refund; the existing `charge.refunded` webhook handler
// (src/app/api/webhooks/stripe/route.ts) is what flips `purchases.status` to
// "refunded" once Stripe confirms it — this module never writes `purchases`
// itself, only `refund_requests`.
//
// Pure validation/eligibility helpers are at the top (no DB, unit-tested
// directly in ./__tests__/refunds.test.ts); DB-backed mutations are below,
// mirroring the `PackageActionError` + `requireDb()` shape src/lib/
// moderation.ts already established for this codebase.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packages, purchases, refundRequests, users } from "@/lib/db/schema";
import { refundPaymentIntent } from "@/lib/stripe";

/** Thrown for any refund-request failure; `status` is the HTTP status the route should return. */
export class RefundError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RefundError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — no DB, no env.
// ---------------------------------------------------------------------------

/** Purchases older than this are no longer eligible for a refund request — see /refund-policy. */
export const REFUND_WINDOW_DAYS = 14;

export const REFUND_STATUSES = ["open", "approved", "denied", "refunded"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const MIN_REASON_CHARS = 10;
export const MAX_REASON_CHARS = 2000;
const MAX_NOTE_CHARS = 2000;

/** Structurally valid `{from -> to}` moves for a refund request, independent
 *  of who's asking. "approved" is part of the status vocabulary (schema.ts)
 *  but nothing here ever sets it: an approve goes straight from "open" to
 *  "refunded" once Stripe confirms the refund (see `resolveRefundRequest`) —
 *  there's no separate "approved, refund pending" state to model. */
const TRANSITIONS: Record<RefundStatus, readonly RefundStatus[]> = {
  open: ["denied", "refunded"],
  approved: ["refunded"],
  denied: [],
  refunded: [],
};

export function isValidRefundTransition(from: RefundStatus, to: RefundStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface RefundEligibilityPurchase {
  status: string;
  createdAt: Date;
  /** Non-null for a subscription purchase — those are cancelled via the billing portal, not refunded. */
  stripeSubscriptionId: string | null;
}

export type RefundEligibility = { eligible: true } | { eligible: false; reason: string };

/**
 * Pure eligibility check for a purchase requesting a refund, independent of
 * whether one has already been requested (that's a DB-level "one open request
 * per purchase" check — see `createRefundRequest`). Only a `paid`, one-time
 * (non-subscription) purchase within `REFUND_WINDOW_DAYS` of its `createdAt`
 * is eligible.
 */
export function refundEligibility(
  purchase: RefundEligibilityPurchase,
  now: Date = new Date()
): RefundEligibility {
  if (purchase.status !== "paid") {
    return { eligible: false, reason: `this purchase is "${purchase.status}", not eligible for a refund request` };
  }
  if (purchase.stripeSubscriptionId) {
    return { eligible: false, reason: "subscriptions are cancelled (not refunded) — use the billing portal" };
  }

  const windowMs = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const ageMs = now.getTime() - purchase.createdAt.getTime();
  if (ageMs > windowMs) {
    return {
      eligible: false,
      reason: `purchases older than ${REFUND_WINDOW_DAYS} days are not eligible for a refund`,
    };
  }

  return { eligible: true };
}

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

type Db = NonNullable<ReturnType<typeof getDb>>;

function requireDb(): Db {
  const db = getDb();
  if (!db) {
    throw new RefundError(503, "refunds require a database; none is configured on this deployment");
  }
  return db;
}

export interface RefundRequestRow {
  id: string;
  purchaseId: string;
  owner: string;
  name: string;
  title: string;
  amountCents: number;
  currency: string;
  reason: string;
  status: RefundStatus;
  sellerNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  /** The buyer's handle, when they have one — included for the seller/admin
   *  views; a buyer looking at their own requests already knows who they are. */
  buyerHandle: string | null;
}

function baseRefundQuery(db: Db) {
  return db
    .select({
      id: refundRequests.id,
      purchaseId: refundRequests.purchaseId,
      reason: refundRequests.reason,
      status: refundRequests.status,
      sellerNote: refundRequests.sellerNote,
      createdAt: refundRequests.createdAt,
      resolvedAt: refundRequests.resolvedAt,
      owner: packages.owner,
      name: packages.name,
      title: packages.title,
      amountCents: purchases.amountCents,
      // Rows written before purchases.currency existed carry no currency of their
      // own; the package's current currency is what those were charged in (same
      // fallback the purchases/payouts pages already use).
      currency: sql<string>`coalesce(${purchases.currency}, ${packages.currency})`,
      buyerHandle: users.handle,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(packages, eq(purchases.packageId, packages.id))
    .leftJoin(users, eq(purchases.userId, users.id));
}

function toRow(r: {
  id: string;
  purchaseId: string;
  reason: string;
  status: string;
  sellerNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  owner: string;
  name: string;
  title: string;
  amountCents: number;
  currency: string;
  buyerHandle: string | null;
}): RefundRequestRow {
  return {
    id: r.id,
    purchaseId: r.purchaseId,
    owner: r.owner,
    name: r.name,
    title: r.title,
    amountCents: r.amountCents,
    currency: r.currency,
    reason: r.reason,
    status: r.status as RefundStatus,
    sellerNote: r.sellerNote,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    buyerHandle: r.buyerHandle,
  };
}

/** The buyer's own refund requests, newest first — for `GET /api/v1/refunds?mine=1`. */
export async function listRefundRequestsForBuyer(userId: string): Promise<RefundRequestRow[]> {
  const db = requireDb();
  const rows = await baseRefundQuery(db)
    .where(eq(purchases.userId, userId))
    .orderBy(desc(refundRequests.createdAt));
  return rows.map(toRow);
}

/** Refund requests on packages `sellerHandle` owns, newest first — for
 *  `GET /api/v1/refunds?seller=1` and the `/settings/payouts` panel. */
export async function listRefundRequestsForSeller(sellerHandle: string): Promise<RefundRequestRow[]> {
  const db = requireDb();
  const rows = await baseRefundQuery(db)
    .where(eq(packages.owner, sellerHandle))
    .orderBy(desc(refundRequests.createdAt));
  return rows.map(toRow);
}

/** Every refund request, newest first — admin-only at the caller level. */
export async function listAllRefundRequests(): Promise<RefundRequestRow[]> {
  const db = requireDb();
  const rows = await baseRefundQuery(db).orderBy(desc(refundRequests.createdAt));
  return rows.map(toRow);
}

/**
 * The most recent refund request per purchase id, for `/purchases` to decide
 * what `RefundRequestButton` should show (already requested vs. eligible vs.
 * not) without a separate round trip per row. Missing from the returned map
 * means that purchase has never had a refund request.
 */
export async function latestRefundRequestsByPurchaseIds(
  purchaseIds: string[]
): Promise<Map<string, { id: string; status: RefundStatus }>> {
  const map = new Map<string, { id: string; status: RefundStatus }>();
  if (purchaseIds.length === 0) return map;

  const db = requireDb();
  const rows = await db
    .select({ purchaseId: refundRequests.purchaseId, id: refundRequests.id, status: refundRequests.status, createdAt: refundRequests.createdAt })
    .from(refundRequests)
    .where(inArray(refundRequests.purchaseId, purchaseIds))
    .orderBy(desc(refundRequests.createdAt));

  // Rows arrive newest-first; keep only the first (most recent) one seen per purchase.
  for (const row of rows) {
    if (!map.has(row.purchaseId)) {
      map.set(row.purchaseId, { id: row.id, status: row.status as RefundStatus });
    }
  }
  return map;
}

export interface CreateRefundRequestArgs {
  userId: string;
  purchaseId: string;
  reason: string;
}

/**
 * Creates a refund request after checking: the purchase exists and belongs to
 * `userId`, it's eligible (`refundEligibility`), and there isn't already an
 * open request for it. Throws `RefundError` for every failure — callers map
 * `.status`/`.message` straight onto the HTTP response.
 */
export async function createRefundRequest(args: CreateRefundRequestArgs): Promise<{ id: string }> {
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON_CHARS || reason.length > MAX_REASON_CHARS) {
    throw new RefundError(400, `reason must be ${MIN_REASON_CHARS}-${MAX_REASON_CHARS} characters`);
  }

  const db = requireDb();

  const [purchase] = await db.select().from(purchases).where(eq(purchases.id, args.purchaseId)).limit(1);
  if (!purchase) throw new RefundError(404, "purchase not found");
  if (purchase.userId !== args.userId) throw new RefundError(403, "you do not own this purchase");

  const eligibility = refundEligibility(purchase);
  if (!eligibility.eligible) {
    throw new RefundError(400, `${eligibility.reason} — see /refund-policy`);
  }

  const [existingOpen] = await db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(and(eq(refundRequests.purchaseId, args.purchaseId), eq(refundRequests.status, "open")))
    .limit(1);
  if (existingOpen) {
    throw new RefundError(409, "a refund request is already open for this purchase");
  }

  const [row] = await db
    .insert(refundRequests)
    .values({ purchaseId: args.purchaseId, userId: args.userId, reason })
    .returning({ id: refundRequests.id });

  return { id: row.id };
}

export interface ResolveRefundRequestArgs {
  id: string;
  action: "approve" | "deny";
  note?: string;
  /** Caller's handle, checked against the package's owner when `isAdminActor`
   *  is false. Ignored when acting as admin. */
  actorHandle?: string;
  isAdminActor: boolean;
}

export interface ResolveRefundRequestResult {
  id: string;
  status: RefundStatus;
}

/**
 * Approves or denies an open refund request. Approving calls
 * `refundPaymentIntent` (full refund, fee/transfer reversed — see the doc
 * comment on that function in src/lib/stripe.ts) *before* writing the new
 * status, so a Stripe failure leaves the request "open" rather than
 * "refunded" with no actual refund behind it; `purchases.status` itself is
 * left for the `charge.refunded` webhook to flip once Stripe confirms.
 */
export async function resolveRefundRequest(
  args: ResolveRefundRequestArgs
): Promise<ResolveRefundRequestResult> {
  const db = requireDb();

  const [row] = await db
    .select({
      id: refundRequests.id,
      status: refundRequests.status,
      stripePaymentIntent: purchases.stripePaymentIntent,
      packageOwner: packages.owner,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(packages, eq(purchases.packageId, packages.id))
    .where(eq(refundRequests.id, args.id))
    .limit(1);
  if (!row) throw new RefundError(404, "refund request not found");

  if (!args.isAdminActor && row.packageOwner !== args.actorHandle) {
    throw new RefundError(403, "only the package's owner or an admin may act on this refund request");
  }

  const current = row.status as RefundStatus;
  const target: RefundStatus = args.action === "approve" ? "refunded" : "denied";
  if (!isValidRefundTransition(current, target)) {
    throw new RefundError(400, `cannot move a refund request from "${current}" to "${target}"`);
  }

  let note: string | undefined;
  if (args.note !== undefined) {
    if (args.note.length > MAX_NOTE_CHARS) {
      throw new RefundError(400, `note must be ${MAX_NOTE_CHARS} characters or fewer`);
    }
    note = args.note.trim() || undefined;
  }

  if (args.action === "approve") {
    if (!row.stripePaymentIntent) {
      throw new RefundError(400, "this purchase has no recorded payment to refund");
    }
    try {
      await refundPaymentIntent(row.stripePaymentIntent);
    } catch (err) {
      throw new RefundError(502, `stripe refund failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await db
    .update(refundRequests)
    .set({ status: target, sellerNote: note ?? null, resolvedAt: new Date() })
    .where(eq(refundRequests.id, args.id));

  return { id: args.id, status: target };
}
