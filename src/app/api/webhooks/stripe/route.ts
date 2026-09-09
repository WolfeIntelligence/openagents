import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, isStripeEnabled } from "@/lib/stripe";
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

  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("missing stripe-signature header");
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json(
      { error: `invalid signature: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
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
