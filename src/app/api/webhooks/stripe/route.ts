import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getConnectedAccountStatus, getStripe, isStripeEnabled } from "@/lib/stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { purchases, users } from "@/lib/db/schema";

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

  if (event.type === "checkout.session.completed") {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    const db = getDb();
    const packageId = checkoutSession.metadata?.packageId;
    const buyerUserId = checkoutSession.metadata?.buyerUserId;

    if (db && packageId && buyerUserId) {
      const paymentIntent = checkoutSession.payment_intent;
      await db.insert(purchases).values({
        userId: buyerUserId,
        packageId,
        stripeSessionId: checkoutSession.id,
        stripePaymentIntent: typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id,
        amountCents: checkoutSession.amount_total ?? 0,
        status: "paid",
      });
    }
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const db = getDb();
    if (db && account.id) {
      await db
        .update(users)
        .set({ stripeOnboarded: Boolean(account.charges_enabled && account.details_submitted) })
        .where(eq(users.stripeAccountId, account.id));
    }
  }

  return NextResponse.json({ received: true });
}
