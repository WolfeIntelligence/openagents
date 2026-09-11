// Purchase lookups and mutations shared by the package detail page, the download
// route, the checkout success-page fallback, and the Stripe webhook. Safe to import
// with zero env vars — every export here degrades harmlessly when Stripe/DB are
// disabled, and none of them throw (failures come back as `false` / `{ ok: false }`).

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getStripe, subscriptionPeriodEnd } from "@/lib/stripe";
import { packages, purchases } from "@/lib/db/schema";
import { notifyPurchaseCompleted } from "@/lib/notify";

// "cancelled" covers a subscription's Stripe object actually going away
// (`customer.subscription.deleted`) — access already ended (`expiresAt` is set to the
// moment it was cancelled), it's not a status a still-active subscriber can be in. A
// failed renewal (`invoice.payment_failed`) deliberately does *not* get its own status:
// access already degrades on its own once `expiresAt` passes (see `isPurchaseActive`
// below), and Stripe eventually fires `customer.subscription.deleted` if every retry
// fails — so there's no "past_due" in this vocabulary to keep in sync with two events
// instead of one.
export type PurchaseStatus = "pending" | "paid" | "failed" | "refunded" | "disputed" | "cancelled";

export interface PurchaseActivity {
  status: PurchaseStatus | string;
  expiresAt: Date | null;
}

/** True when a purchase currently grants access: `paid`, and either perpetual
 *  (`expiresAt` null — a one-time purchase) or still within its paid-through period.
 *  A subscription whose period has lapsed (renewal failed, or it was cancelled) reads
 *  as inactive here even before any webhook flips its status — expiry is time-based,
 *  not just status-based, so access can't outlive a period no one actually paid for. */
export function isPurchaseActive(
  purchase: PurchaseActivity,
  now: Date = new Date()
): boolean {
  if (purchase.status !== "paid") return false;
  if (purchase.expiresAt === null) return true;
  return purchase.expiresAt.getTime() > now.getTime();
}

/** True when `userId` has a currently-active purchase of the `owner/name` package —
 *  a `paid` one-time purchase, or a `paid` subscription whose `expiresAt` hasn't
 *  passed yet. Always false when the DB is disabled, the package isn't DB-backed, or
 *  the lookup itself throws — this gates paid downloads, so it fails closed rather
 *  than propagating an error. */
export async function hasPurchased(
  userId: string,
  owner: string,
  name: string
): Promise<boolean> {
  try {
    const db = getDb();
    if (!db) return false;

    const [dbPackage] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(and(eq(packages.owner, owner), eq(packages.name, name)))
      .limit(1);
    if (!dbPackage) return false;

    const rows = await db
      .select({ status: purchases.status, expiresAt: purchases.expiresAt })
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, userId),
          eq(purchases.packageId, dbPackage.id),
          eq(purchases.status, "paid")
        )
      );
    const now = new Date();
    return rows.some((row) => isPurchaseActive(row, now));
  } catch {
    return false;
  }
}

export interface ActivePurchase {
  /** "subscription" when a `stripeSubscriptionId` is on the row, "one-time" otherwise. */
  kind: "one-time" | "subscription";
  expiresAt: Date | null;
  stripeSubscriptionId: string | null;
}

/** Returns the currently-active purchase (if any) of `owner/name` by `userId`, for
 *  surfaces that need more than a yes/no — the package page's "renews on <date>"
 *  copy and `/purchases`. A user can accumulate more than one purchase row for the
 *  same package over time (e.g. subscribe, let it lapse, subscribe again), so this
 *  picks the most recent row that's still active rather than just the latest row.
 *  Null when the DB is disabled, the package isn't DB-backed, nothing is active, or
 *  the lookup throws — same fail-closed shape as `hasPurchased`. */
export async function getActivePurchase(
  userId: string,
  owner: string,
  name: string
): Promise<ActivePurchase | null> {
  try {
    const db = getDb();
    if (!db) return null;

    const [dbPackage] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(and(eq(packages.owner, owner), eq(packages.name, name)))
      .limit(1);
    if (!dbPackage) return null;

    const rows = await db
      .select({
        status: purchases.status,
        expiresAt: purchases.expiresAt,
        stripeSubscriptionId: purchases.stripeSubscriptionId,
      })
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, userId),
          eq(purchases.packageId, dbPackage.id),
          eq(purchases.status, "paid")
        )
      )
      .orderBy(desc(purchases.createdAt));

    const now = new Date();
    const active = rows.find((row) => isPurchaseActive(row, now));
    if (!active) return null;

    return {
      kind: active.stripeSubscriptionId ? "subscription" : "one-time",
      expiresAt: active.expiresAt,
      stripeSubscriptionId: active.stripeSubscriptionId,
    };
  } catch {
    return null;
  }
}

type Db = NonNullable<ReturnType<typeof getDb>>;

interface RecordPaidPurchaseArgs {
  userId: string;
  packageId: string;
  stripeSessionId: string;
  stripePaymentIntent?: string | null;
  amountCents: number;
  /** ISO 4217 lowercase, as charged (Stripe reports it on the session). */
  currency?: string | null;
  /** Stripe-hosted receipt for the charge, when the caller could resolve one
   *  (the webhook looks this up via the PaymentIntent's latest charge). */
  receiptUrl?: string | null;
}

/**
 * Idempotently records a completed purchase. A given Stripe Checkout Session can be
 * reported to us more than once — `checkout.session.completed` redelivering, and the
 * package-page success-banner fallback (`confirmCheckoutSession` below) racing the
 * webhook — so the insert leans on the `purchases_stripe_session_unique` constraint:
 * a second report of the same session updates at most `receiptUrl`, and only when the
 * existing row doesn't have one yet (`coalesce(existing, incoming)`) — every other
 * column (amount, status, ids) is set once by whichever report lands first and never
 * touched again, so a redelivery can't rewrite what was actually charged.
 *
 * The pre-check below only decides `isNew` for the caller (so it can fire
 * `notifyPurchaseCompleted` once, not on every redelivery) — it isn't what keeps this
 * idempotent. That's still the `onConflictDoUpdate` against the unique constraint: two
 * redeliveries racing each other can both see "no existing row" and both attempt the
 * insert, but only one actually creates a row; the loser's `onConflictDoUpdate` folds
 * into it instead of erroring. In that rare race both callers would see `isNew: true`
 * and notify twice — acceptable for a fire-and-forget notification, not for the row
 * itself, which the constraint keeps singular.
 */
export async function recordPaidPurchase(
  db: Db,
  args: RecordPaidPurchaseArgs
): Promise<{ id: string; isNew: boolean }> {
  const [existing] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.stripeSessionId, args.stripeSessionId))
    .limit(1);

  const [row] = await db
    .insert(purchases)
    .values({
      userId: args.userId,
      packageId: args.packageId,
      stripeSessionId: args.stripeSessionId,
      stripePaymentIntent: args.stripePaymentIntent ?? undefined,
      amountCents: args.amountCents,
      currency: args.currency ?? undefined,
      receiptUrl: args.receiptUrl ?? undefined,
      status: "paid",
    })
    .onConflictDoUpdate({
      target: purchases.stripeSessionId,
      set: {
        receiptUrl: sql`coalesce(${purchases.receiptUrl}, excluded."receiptUrl")`,
      },
    })
    .returning({ id: purchases.id });

  return { id: row.id, isNew: !existing };
}

/** Marks the purchase for `stripeSessionId` as `failed` (used for
 *  `checkout.session.async_payment_failed`). A no-op if no row exists yet — nothing
 *  was ever recorded as paid, so there's nothing to fail. */
export async function markSessionFailed(db: Db, stripeSessionId: string): Promise<void> {
  await db
    .update(purchases)
    .set({ status: "failed" })
    .where(eq(purchases.stripeSessionId, stripeSessionId));
}

/** Updates the purchase(s) for a given Stripe PaymentIntent — used by the refund and
 *  dispute webhook handlers, which key off `charge.payment_intent` rather than the
 *  Checkout Session id. */
export async function setStatusByPaymentIntent(
  db: Db,
  stripePaymentIntent: string,
  status: PurchaseStatus
): Promise<void> {
  await db
    .update(purchases)
    .set({ status })
    .where(eq(purchases.stripePaymentIntent, stripePaymentIntent));
}

interface RecordSubscriptionPurchaseArgs {
  userId: string;
  packageId: string;
  stripeSessionId: string;
  stripeSubscriptionId: string;
  amountCents: number;
  currency?: string | null;
  /** The subscription's paid-through date — `getStripe`'s caller resolves this from
   *  the Subscription object (see `subscriptionPeriodEnd` in src/lib/stripe.ts) before
   *  calling here, since only the caller knows which Stripe API call to make. */
  expiresAt: Date;
}

/**
 * Idempotently records a subscription's first successful payment
 * (`checkout.session.completed` in `mode: "subscription"`). Same shape as
 * `recordPaidPurchase`, keyed off the same `stripeSessionId` unique constraint —
 * a subscription's Checkout Session only ever completes once, so this only exists
 * separately because the columns being set (`stripeSubscriptionId`, `expiresAt`,
 * no `receiptUrl`) differ from the one-time path.
 */
export async function recordSubscriptionPurchase(
  db: Db,
  args: RecordSubscriptionPurchaseArgs
): Promise<{ id: string; isNew: boolean }> {
  const [existing] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.stripeSessionId, args.stripeSessionId))
    .limit(1);

  const [row] = await db
    .insert(purchases)
    .values({
      userId: args.userId,
      packageId: args.packageId,
      stripeSessionId: args.stripeSessionId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      amountCents: args.amountCents,
      currency: args.currency ?? undefined,
      expiresAt: args.expiresAt,
      status: "paid",
    })
    .onConflictDoUpdate({
      target: purchases.stripeSessionId,
      set: {
        stripeSubscriptionId: args.stripeSubscriptionId,
        expiresAt: args.expiresAt,
        status: "paid",
      },
    })
    .returning({ id: purchases.id });

  return { id: row.id, isNew: !existing };
}

interface ExtendSubscriptionPeriodArgs {
  stripeSubscriptionId: string;
  /** New paid-through date, from the renewed Subscription's `subscriptionPeriodEnd`. */
  expiresAt: Date;
  /** Only used to create the row when none exists yet — e.g. `invoice.paid` for a
   *  subscription's first period arriving before `checkout.session.completed` does.
   *  Sourced from the Subscription's own metadata (set in `createCheckoutSession`'s
   *  `subscription_data.metadata`), since that's the only place left to find them once
   *  a renewal, rather than the original checkout, is what's driving this. */
  fallback: { userId: string; packageId: string; amountCents: number; currency?: string | null };
}

/**
 * Extends (or, failing that, creates) the purchase row for a subscription renewal
 * (`invoice.paid`). Keyed off `stripeSubscriptionId` rather than a session id — a
 * renewal has no Checkout Session at all. Idempotent: redelivering the same
 * `invoice.paid` just sets `expiresAt` to the same value again.
 */
export async function extendSubscriptionPeriod(
  db: Db,
  args: ExtendSubscriptionPeriodArgs
): Promise<{ id: string; isNew: boolean }> {
  const [updated] = await db
    .update(purchases)
    .set({ expiresAt: args.expiresAt, status: "paid" })
    .where(eq(purchases.stripeSubscriptionId, args.stripeSubscriptionId))
    .returning({ id: purchases.id });
  if (updated) return { id: updated.id, isNew: false };

  const [inserted] = await db
    .insert(purchases)
    .values({
      userId: args.fallback.userId,
      packageId: args.fallback.packageId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      amountCents: args.fallback.amountCents,
      currency: args.fallback.currency ?? undefined,
      expiresAt: args.expiresAt,
      status: "paid",
    })
    .returning({ id: purchases.id });
  return { id: inserted.id, isNew: true };
}

/** Syncs `expiresAt` to a subscription's current period end (`customer.subscription.
 *  updated`) — covers `cancel_at_period_end` being toggled (access still runs out
 *  exactly when the period does, whether or not it renews) as well as any other
 *  update that shifts the period. Never touches `status`: an update event doesn't by
 *  itself mean the subscription stopped being paid. A no-op if no row exists yet. */
export async function updateSubscriptionExpiry(
  db: Db,
  stripeSubscriptionId: string,
  expiresAt: Date
): Promise<void> {
  await db
    .update(purchases)
    .set({ expiresAt })
    .where(eq(purchases.stripeSubscriptionId, stripeSubscriptionId));
}

/** Ends access immediately (`customer.subscription.deleted` — Stripe only fires this
 *  once the subscription is actually gone, whether that's an immediate cancellation
 *  or the natural end of a `cancel_at_period_end` period). Sets `expiresAt` to `now`
 *  rather than leaving whatever value was last synced, so access ends exactly when
 *  Stripe says the subscription did, not whenever we last happened to hear from it. */
export async function cancelSubscriptionPurchase(
  db: Db,
  stripeSubscriptionId: string,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(purchases)
    .set({ expiresAt: now, status: "cancelled" })
    .where(eq(purchases.stripeSubscriptionId, stripeSubscriptionId));
}

type StripeClient = NonNullable<ReturnType<typeof getStripe>>;

/**
 * Best-effort Stripe-hosted receipt lookup: retrieves the PaymentIntent (expanding its
 * latest charge) and returns that charge's `receipt_url`. Shared by the webhook and
 * `confirmCheckoutSession` so both recording paths attach a receipt the same way.
 * Never throws — a receipt link is never worth failing a purchase over — and returns
 * null for a missing id, an unresolvable charge, or any Stripe error.
 */
export async function resolveReceiptUrl(
  stripe: StripeClient,
  paymentIntentId: string | undefined
): Promise<string | null> {
  if (!paymentIntentId) return null;
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge = paymentIntent.latest_charge;
    return typeof charge === "string" ? null : (charge?.receipt_url ?? null);
  } catch {
    return null;
  }
}

/**
 * Confirms a Checkout Session actually belongs to `userId` and was paid, then records
 * it exactly like the webhook does. Used as a fallback on the package page so
 * `?checkout=success` never grants access on the bare query string alone: Stripe is
 * asked directly, and only a genuinely paid session for this user is recorded. Never
 * throws — failures come back as `{ ok: false, reason }` so the caller can render a
 * "still processing" state instead of a hard error.
 */
export async function confirmCheckoutSession(
  sessionId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const stripe = getStripe();
    const db = getDb();
    if (!stripe || !db) return { ok: false, reason: "payments not configured" };

    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
    if (checkoutSession.metadata?.buyerUserId !== userId) {
      return { ok: false, reason: "session does not belong to this user" };
    }
    const packageId = checkoutSession.metadata?.packageId;
    const owner = checkoutSession.metadata?.owner;
    const name = checkoutSession.metadata?.name;
    if (!packageId || !owner || !name) {
      return { ok: false, reason: "session is missing package metadata" };
    }
    if (checkoutSession.payment_status !== "paid") {
      return { ok: false, reason: "payment not completed" };
    }

    // A subscription session's `payment_status` is "paid" as soon as its first
    // invoice succeeds — same signal as a one-time session — but it needs the
    // subscription/expiry columns a one-time purchase doesn't have, so it's recorded
    // through `recordSubscriptionPurchase` instead. Mirrors the webhook's branch below.
    if (checkoutSession.mode === "subscription") {
      const stripeSubscriptionId =
        typeof checkoutSession.subscription === "string"
          ? checkoutSession.subscription
          : checkoutSession.subscription?.id;
      if (!stripeSubscriptionId) {
        return { ok: false, reason: "session is missing its subscription" };
      }
      const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      const expiresAt = subscriptionPeriodEnd(subscription);
      if (!expiresAt) {
        return { ok: false, reason: "subscription has no billing period" };
      }
      const { id: purchaseId, isNew } = await recordSubscriptionPurchase(db, {
        userId,
        packageId,
        stripeSessionId: checkoutSession.id,
        stripeSubscriptionId,
        amountCents: checkoutSession.amount_total ?? 0,
        currency: checkoutSession.currency,
        expiresAt,
      });
      if (isNew) {
        void notifyPurchaseCompleted({
          purchaseId,
          buyerUserId: userId,
          owner,
          name,
          amountCents: checkoutSession.amount_total ?? 0,
          currency: checkoutSession.currency ?? "usd",
          kind: "subscription",
        });
      }
      return { ok: true };
    }

    const paymentIntent = checkoutSession.payment_intent;
    const stripePaymentIntent =
      typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
    const receiptUrl = await resolveReceiptUrl(stripe, stripePaymentIntent);
    const { id: purchaseId, isNew } = await recordPaidPurchase(db, {
      userId,
      packageId,
      stripeSessionId: checkoutSession.id,
      stripePaymentIntent,
      amountCents: checkoutSession.amount_total ?? 0,
      currency: checkoutSession.currency,
      receiptUrl,
    });
    if (isNew) {
      void notifyPurchaseCompleted({
        purchaseId,
        buyerUserId: userId,
        owner,
        name,
        amountCents: checkoutSession.amount_total ?? 0,
        currency: checkoutSession.currency ?? "usd",
        receiptUrl,
        kind: "one-time",
      });
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "could not confirm checkout session" };
  }
}
