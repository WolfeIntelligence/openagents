// Opens a Stripe Billing Portal session for the signed-in buyer, so a subscriber can
// update their payment method, see invoices, or cancel — without OpenAgents needing to
// build any of that itself. Zero-env safe: 503s (like every other payments route) when
// Stripe isn't configured, and 400s when the signed-in user has never checked out for a
// subscription (no `users.stripeCustomerId` on file to open a portal session for).

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getStripe, isStripeEnabled } from "@/lib/stripe";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stripe = getStripe();
  const db = getDb();
  if (!stripe || !db) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!user?.stripeCustomerId) {
    return NextResponse.json({ error: "no billing account on file" }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${siteUrl}/purchases`,
    });
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not open billing portal" },
      { status: 400 }
    );
  }
}
