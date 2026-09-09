// Stripe Connect (Express) integration. Safe to import with zero env vars — getStripe()
// returns null and isStripeEnabled() is false until STRIPE_SECRET_KEY is set. No client
// is instantiated at module load time.

import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packages, users } from "@/lib/db/schema";
import type { Package } from "@/lib/types";

let cached: Stripe | null | undefined;

export function isStripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    cached = null;
    return cached;
  }
  cached = new Stripe(key);
  return cached;
}

/** Platform cut, in basis points (1000 = 10%). */
export const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? "1000");

export interface CreateCheckoutSessionArgs {
  pkg: Package;
  buyerUserId: string;
  successUrl: string;
  cancelUrl: string;
}

/** Creates a one-time Stripe Checkout Session for a paid package, routing funds to the
 *  seller's connected account via a destination charge (transfer_data.destination) minus
 *  the platform's application_fee_amount. Throws if Stripe/DB aren't configured or the
 *  seller hasn't completed Connect onboarding. */
export async function createCheckoutSession({
  pkg,
  buyerUserId,
  successUrl,
  cancelUrl,
}: CreateCheckoutSessionArgs): Promise<{ url: string }> {
  const stripe = getStripe();
  const db = getDb();
  if (!stripe || !db) throw new Error("payments not configured");

  const [seller] = await db.select().from(users).where(eq(users.handle, pkg.owner)).limit(1);
  if (!seller?.stripeAccountId || !seller.stripeOnboarded) {
    throw new Error(`seller ${pkg.owner} has not completed payments onboarding`);
  }

  // `pkg.id` (from src/lib/types.ts) is the "owner/name" composite id used across the
  // app — NOT the DB row's uuid primary key that purchases.packageId (a uuid FK)
  // expects. Look up the real row id here so the webhook can record the purchase.
  const [dbPackage] = await db
    .select({ id: packages.id })
    .from(packages)
    .where(and(eq(packages.owner, pkg.owner), eq(packages.name, pkg.name)))
    .limit(1);
  if (!dbPackage) {
    throw new Error(`package ${pkg.id} is not purchasable (not a DB-backed package)`);
  }

  const amountCents = pkg.manifest.pricing.amountCents;
  const currency = pkg.manifest.pricing.currency;
  const applicationFeeAmount = Math.round((amountCents * PLATFORM_FEE_BPS) / 10000);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency,
          unit_amount: amountCents,
          product_data: {
            name: pkg.manifest.title,
            description: pkg.manifest.summary,
          },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFeeAmount,
      transfer_data: { destination: seller.stripeAccountId },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      packageId: dbPackage.id,
      owner: pkg.owner,
      name: pkg.name,
      buyerUserId,
    },
  });

  if (!session.url) throw new Error("stripe did not return a checkout url");
  return { url: session.url };
}

/** Creates (if needed) a Stripe Express account for the user and returns an onboarding
 *  link URL. Throws if Stripe/DB aren't configured. */
export async function createConnectOnboardingLink(
  userId: string,
  returnUrl: string
): Promise<{ url: string }> {
  const stripe = getStripe();
  const db = getDb();
  if (!stripe || !db) throw new Error("payments not configured");

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("user not found");

  let accountId = user.stripeAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: user.email ?? undefined,
    });
    accountId = account.id;
    await db.update(users).set({ stripeAccountId: accountId }).where(eq(users.id, userId));
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: returnUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return { url: link.url };
}
