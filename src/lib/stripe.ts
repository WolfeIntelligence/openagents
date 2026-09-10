// Stripe Connect (Express) integration. Safe to import with zero env vars — getStripe()
// returns null and isStripeEnabled() is false until STRIPE_SECRET_KEY is set. No client
// is instantiated at module load time.

import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packages, users } from "@/lib/db/schema";
import type { Package } from "@/lib/types";
import { isSupportedCurrency } from "@/lib/format";

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

/** Default country (ISO 3166-1 alpha-2) used for new Connect accounts' `identity.country`. */
export const DEFAULT_CONNECT_COUNTRY = "US";

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
  if (!isSupportedCurrency(currency)) {
    throw new Error(`package ${pkg.id} has an unsupported currency: ${currency}`);
  }
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
      currency,
    },
  });

  if (!session.url) throw new Error("stripe did not return a checkout url");
  return { url: session.url };
}

/** Creates (if needed) a Stripe **Accounts v2** connected account for the user, configured
 *  as a `recipient` (we run destination charges from `createCheckoutSession` — the
 *  platform collects the card payment and transfers the seller's share via
 *  `transfer_data.destination` + `application_fee_amount`, so the connected account never
 *  needs to be the merchant of record) with an Express dashboard, and returns an
 *  onboarding link URL. `refreshUrl` is where Stripe sends the user back if the link
 *  itself expired (defaults to `returnUrl` when omitted); `returnUrl` is where they land
 *  after completing (or exiting) the flow. Throws if Stripe/DB aren't configured.
 *
 *  v1 Accounts (`stripe.accounts.create`) are no longer accepted for new Connect
 *  integrations — see https://docs.stripe.com/connect/accounts-v2/account-creation. */
export async function createConnectOnboardingLink(
  userId: string,
  returnUrl: string,
  refreshUrl: string = returnUrl
): Promise<{ url: string }> {
  const stripe = getStripe();
  const db = getDb();
  if (!stripe || !db) throw new Error("payments not configured");

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("user not found");

  let accountId = user.stripeAccountId;
  if (!accountId) {
    const account = await stripe.v2.core.accounts.create({
      contact_email: user.email ?? undefined,
      dashboard: "express",
      defaults: {
        responsibilities: {
          // Platform (us) collects Stripe's fees and is on the hook for negative
          // balances, matching how a v1 Express account behaves for a marketplace that
          // charges an application fee on destination charges.
          fees_collector: "application_express",
          losses_collector: "application",
        },
      },
      identity: {
        country: DEFAULT_CONNECT_COUNTRY,
      },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { requested: true },
            },
          },
        },
      },
      include: ["configuration.recipient", "requirements"],
    });
    accountId = account.id;
    await db.update(users).set({ stripeAccountId: accountId }).where(eq(users.id, userId));
  }

  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        refresh_url: refreshUrl,
        return_url: returnUrl,
      },
    },
  });

  return { url: link.url };
}

export interface ConnectedAccountStatus {
  /** Fully onboarded: transfers capability active and nothing currently blocking it. */
  onboarded: boolean;
  /** No requirement is currently (or past) due — Stripe has what it needs for now. */
  detailsSubmitted: boolean;
  /** The `stripe_balance.stripe_transfers` recipient capability is `active`. */
  transfersActive: boolean;
}

/** Retrieves a v2 Connect account's recipient-configuration status. Throws if Stripe
 *  isn't configured. */
export async function getConnectedAccountStatus(accountId: string): Promise<ConnectedAccountStatus> {
  const stripe = getStripe();
  if (!stripe) throw new Error("payments not configured");

  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient", "requirements"],
  });

  const transfersActive =
    account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";

  // `requirements.summary.minimum_deadline` is only present when some requirement has an
  // active deadline; its `status` is the strictest of any outstanding requirement.
  // Nothing due (or the field is absent entirely) means Stripe isn't currently blocked
  // on the seller for more information.
  const deadlineStatus = account.requirements?.summary?.minimum_deadline?.status;
  const detailsSubmitted = deadlineStatus !== "currently_due" && deadlineStatus !== "past_due";

  return {
    onboarded: transfersActive && detailsSubmitted,
    detailsSubmitted,
    transfersActive,
  };
}
