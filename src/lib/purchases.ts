// Purchase lookups and mutations shared by the package detail page, the download
// route, the checkout success-page fallback, and the Stripe webhook. Safe to import
// with zero env vars — every export here degrades harmlessly when Stripe/DB are
// disabled, and none of them throw (failures come back as `false` / `{ ok: false }`).

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getStripe } from "@/lib/stripe";
import { packages, purchases } from "@/lib/db/schema";

export type PurchaseStatus = "pending" | "paid" | "failed" | "refunded" | "disputed";

/** True when `userId` has a `paid` purchase of the `owner/name` package. Always false
 *  when the DB is disabled, the package isn't DB-backed, or the lookup itself throws —
 *  this gates paid downloads, so it fails closed rather than propagating an error. */
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

    const [purchase] = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, userId),
          eq(purchases.packageId, dbPackage.id),
          eq(purchases.status, "paid")
        )
      )
      .limit(1);
    return Boolean(purchase);
  } catch {
    return false;
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
 */
export async function recordPaidPurchase(db: Db, args: RecordPaidPurchaseArgs): Promise<void> {
  await db
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
    });
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
    if (!packageId) {
      return { ok: false, reason: "session is missing package metadata" };
    }
    if (checkoutSession.payment_status !== "paid") {
      return { ok: false, reason: "payment not completed" };
    }

    const paymentIntent = checkoutSession.payment_intent;
    const stripePaymentIntent =
      typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
    const receiptUrl = await resolveReceiptUrl(stripe, stripePaymentIntent);
    await recordPaidPurchase(db, {
      userId,
      packageId,
      stripeSessionId: checkoutSession.id,
      stripePaymentIntent,
      amountCents: checkoutSession.amount_total ?? 0,
      currency: checkoutSession.currency,
      receiptUrl,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "could not confirm checkout session" };
  }
}
