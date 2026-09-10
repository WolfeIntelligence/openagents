import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getConnectedAccountStatus, getStripe, isStripeEnabled } from "@/lib/stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { markSessionFailed, recordPaidPurchase, setStatusByPaymentIntent } from "@/lib/purchases";

/** Extracts a PaymentIntent id whether the field came back expanded or not. */
function paymentIntentId(pi: string | Stripe.PaymentIntent | null | undefined): string | undefined {
  return typeof pi === "string" ? pi : pi?.id;
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
      const db = getDb();
      if (db && packageId && buyerUserId) {
        try {
          await recordPaidPurchase(db, {
            userId: buyerUserId,
            packageId,
            stripeSessionId: checkoutSession.id,
            stripePaymentIntent: paymentIntentId(checkoutSession.payment_intent),
            amountCents: checkoutSession.amount_total ?? 0,
            currency: checkoutSession.currency,
          });
        } catch {
          // DB write failed — ask Stripe to retry rather than silently dropping a sale.
          return NextResponse.json({ error: "failed to record purchase" }, { status: 500 });
        }
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
