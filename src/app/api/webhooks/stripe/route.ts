import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getConnectedAccountStatus, getStripe, isStripeEnabled, subscriptionPeriodEnd } from "@/lib/stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  cancelSubscriptionPurchase,
  extendSubscriptionPeriod,
  markSessionFailed,
  recordPaidPurchase,
  recordSubscriptionPurchase,
  resolveReceiptUrl,
  setStatusByPaymentIntent,
  updateSubscriptionExpiry,
} from "@/lib/purchases";
import { notifyPurchaseCompleted } from "@/lib/notify";

/** Extracts a PaymentIntent id whether the field came back expanded or not. */
function paymentIntentId(pi: string | Stripe.PaymentIntent | null | undefined): string | undefined {
  return typeof pi === "string" ? pi : pi?.id;
}

/** Extracts a Subscription id whether the field came back expanded or not — shared by
 *  every subscription-lifecycle handler below. */
function subscriptionId(sub: string | Stripe.Subscription | null | undefined): string | undefined {
  return typeof sub === "string" ? sub : sub?.id;
}

/** An invoice's subscription id, if it belongs to one. Stripe moved this off a flat
 *  `invoice.subscription` field and onto `invoice.parent.subscription_details.
 *  subscription` (see node_modules/stripe/cjs/resources/Invoices.d.ts) — a one-off
 *  invoice (`parent.type !== "subscription_details"`) has no `subscription_details`
 *  at all, which this treats the same as "no subscription" rather than a type error. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  return subscriptionId(invoice.parent?.subscription_details?.subscription ?? undefined);
}

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();
  if (!signature) {
    return NextResponse.json(
      { error: "invalid signature: missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json(
      { error: `invalid signature: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  // v2 Connect events (Accounts v2 recipient-configuration + requirements updates) are
  // delivered to this same endpoint as "thin" events — `object: "v2.core.event"`, no
  // `data.object`. `constructEvent` above only verifies the signature and parses the
  // JSON body, so a thin event still comes through successfully as `event`; detect that
  // shape here and hand the raw body to the v2-aware parser instead, which gives us a
  // typed notification (with `related_object`) rather than guessing at the raw payload.
  // This branch must never 500 — an account we can't resolve just gets skipped, and
  // Stripe will redeliver.
  if ((event as unknown as { object?: string }).object === "v2.core.event") {
    try {
      const notification = stripe.parseEventNotification(rawBody, signature, webhookSecret);
      if (notification.type.startsWith("v2.core.account")) {
        const accountId = (notification as { related_object?: { id?: string } }).related_object?.id;
        const db = getDb();
        if (db && accountId) {
          const status = await getConnectedAccountStatus(accountId);
          await db
            .update(users)
            .set({ stripeOnboarded: status.onboarded })
            .where(eq(users.stripeAccountId, accountId));
        }
      }
    } catch {
      // Couldn't parse or resolve this v2 event — nothing to do, don't fail the delivery.
    }
    return NextResponse.json({ received: true });
  }

  // A Checkout Session only ever represents a real sale once Stripe considers the
  // payment collected — `checkout.session.completed` fires for async payment methods
  // too, before the money has actually arrived, so `payment_status` (not the event
  // type) is what gates recording a purchase here.
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    if (checkoutSession.payment_status === "paid") {
      const packageId = checkoutSession.metadata?.packageId;
      const buyerUserId = checkoutSession.metadata?.buyerUserId;
      const owner = checkoutSession.metadata?.owner;
      const name = checkoutSession.metadata?.name;
      const db = getDb();
      if (db && packageId && buyerUserId && owner && name) {
        try {
          if (checkoutSession.mode === "subscription") {
            const subId = subscriptionId(checkoutSession.subscription);
            if (subId) {
              const subscription = await stripe.subscriptions.retrieve(subId);
              const expiresAt = subscriptionPeriodEnd(subscription);
              if (expiresAt) {
                const { id: purchaseId, isNew } = await recordSubscriptionPurchase(db, {
                  userId: buyerUserId,
                  packageId,
                  stripeSessionId: checkoutSession.id,
                  stripeSubscriptionId: subId,
                  amountCents: checkoutSession.amount_total ?? 0,
                  currency: checkoutSession.currency,
                  expiresAt,
                });
                if (isNew) {
                  void notifyPurchaseCompleted({
                    purchaseId,
                    buyerUserId,
                    owner,
                    name,
                    amountCents: checkoutSession.amount_total ?? 0,
                    currency: checkoutSession.currency ?? "usd",
                    kind: "subscription",
                  });
                }
              }
            }
          } else {
            const stripePaymentIntent = paymentIntentId(checkoutSession.payment_intent);
            // Best-effort — a receipt lookup failure must never drop the sale itself.
            const receiptUrl = await resolveReceiptUrl(stripe, stripePaymentIntent);
            const { id: purchaseId, isNew } = await recordPaidPurchase(db, {
              userId: buyerUserId,
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
                buyerUserId,
                owner,
                name,
                amountCents: checkoutSession.amount_total ?? 0,
                currency: checkoutSession.currency ?? "usd",
                receiptUrl,
                kind: "one-time",
              });
            }
          }
        } catch {
          // DB write failed — ask Stripe to retry rather than silently dropping a sale.
          return NextResponse.json({ error: "failed to record purchase" }, { status: 500 });
        }
      }
    }
  }

  // A subscription renewal has no Checkout Session — `invoice.paid` is the only signal
  // that a later period was actually charged, so it's what extends `expiresAt`. Falls
  // back to creating the purchase row (from the Subscription's own metadata) in the
  // unlikely event this arrives before `checkout.session.completed` does.
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = invoiceSubscriptionId(invoice);
    const db = getDb();
    if (db && subId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(subId);
        const expiresAt = subscriptionPeriodEnd(subscription);
        const packageId = subscription.metadata?.packageId;
        const buyerUserId = subscription.metadata?.buyerUserId;
        const owner = subscription.metadata?.owner;
        const name = subscription.metadata?.name;
        if (expiresAt && packageId && buyerUserId && owner && name) {
          const { id: purchaseId, isNew } = await extendSubscriptionPeriod(db, {
            stripeSubscriptionId: subId,
            expiresAt,
            fallback: {
              userId: buyerUserId,
              packageId,
              amountCents: invoice.amount_paid,
              currency: invoice.currency,
            },
          });
          // Only the fallback insert path is a "first" purchase worth notifying on —
          // the normal case (a row already exists from checkout.session.completed) is
          // a renewal, which already got its own notification when it was created.
          if (isNew) {
            void notifyPurchaseCompleted({
              purchaseId,
              buyerUserId,
              owner,
              name,
              amountCents: invoice.amount_paid,
              currency: invoice.currency,
              kind: "subscription",
            });
          }
        }
      } catch {
        return NextResponse.json({ error: "failed to extend subscription" }, { status: 500 });
      }
    }
  }

  // Deliberately a no-op: our status vocabulary has no "past_due" (see the comment on
  // PurchaseStatus in src/lib/purchases.ts). Access already degrades on its own once
  // `expiresAt` passes — a failed renewal just means the next `invoice.paid` never
  // arrives to push it forward — and Stripe fires `customer.subscription.deleted`
  // once retries are exhausted, which is what actually revokes access early if the
  // subscription is cancelled outright rather than merely failing to renew yet.
  if (event.type === "invoice.payment_failed") {
    return NextResponse.json({ received: true });
  }

  // Fires once the subscription is actually gone — an immediate cancellation, or the
  // natural end of a `cancel_at_period_end` period. Ends access right away rather than
  // trusting whatever `expiresAt` was last synced to.
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const db = getDb();
    if (db) {
      try {
        await cancelSubscriptionPurchase(db, subscription.id);
      } catch {
        return NextResponse.json({ error: "failed to cancel subscription" }, { status: 500 });
      }
    }
  }

  // Covers `cancel_at_period_end` being toggled, a plan change, or anything else that
  // shifts the subscription's period — `expiresAt` is kept in sync with wherever the
  // period actually ends, without assuming the subscription will therefore renew (it
  // only actually ends access once `customer.subscription.deleted` fires above).
  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;
    const expiresAt = subscriptionPeriodEnd(subscription);
    const db = getDb();
    if (db && expiresAt) {
      try {
        await updateSubscriptionExpiry(db, subscription.id, expiresAt);
      } catch {
        return NextResponse.json({ error: "failed to update subscription" }, { status: 500 });
      }
    }
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    const db = getDb();
    if (db) {
      try {
        await markSessionFailed(db, checkoutSession.id);
      } catch {
        return NextResponse.json({ error: "failed to update purchase" }, { status: 500 });
      }
    }
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const piId = paymentIntentId(charge.payment_intent);
    const db = getDb();
    // A partial refund leaves the purchase `paid` — only a full refund revokes access.
    if (db && piId && charge.amount_refunded >= charge.amount) {
      try {
        await setStatusByPaymentIntent(db, piId, "refunded");
      } catch {
        return NextResponse.json({ error: "failed to update purchase" }, { status: 500 });
      }
    }
  }

  if (event.type === "charge.dispute.created") {
    const dispute = event.data.object as Stripe.Dispute;
    const piId = paymentIntentId(dispute.payment_intent);
    const db = getDb();
    if (db && piId) {
      try {
        await setStatusByPaymentIntent(db, piId, "disputed");
      } catch {
        return NextResponse.json({ error: "failed to update purchase" }, { status: 500 });
      }
    }
  }

  if (event.type === "charge.dispute.closed") {
    const dispute = event.data.object as Stripe.Dispute;
    const piId = paymentIntentId(dispute.payment_intent);
    const db = getDb();
    if (db && piId) {
      try {
        await setStatusByPaymentIntent(db, piId, dispute.status === "won" ? "paid" : "refunded");
      } catch {
        return NextResponse.json({ error: "failed to update purchase" }, { status: 500 });
      }
    }
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const db = getDb();
    // Only trust this when Stripe actually sent both flags — a partial/legacy payload
    // missing one must not be read as "false" and flip a genuinely onboarded seller
    // back to not-onboarded.
    const hasBooleanFlags =
      typeof account.charges_enabled === "boolean" && typeof account.details_submitted === "boolean";
    if (db && account.id && hasBooleanFlags) {
      await db
        .update(users)
        .set({ stripeOnboarded: Boolean(account.charges_enabled && account.details_submitted) })
        .where(eq(users.stripeAccountId, account.id));
    }
  }

  return NextResponse.json({ received: true });
}
