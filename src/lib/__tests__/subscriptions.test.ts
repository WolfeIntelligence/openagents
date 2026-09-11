// Run with: npx tsx --test src/lib/__tests__/subscriptions.test.ts
// (or: npm test, which runs every *.test.ts file in this directory).
//
// Covers the pure pieces of REAL SUBSCRIPTIONS (Y1): price display (formatPricing),
// the expiry rule that gates access (isPurchaseActive), and reading a Subscription's
// paid-through date (subscriptionPeriodEnd) — the one genuinely easy-to-get-wrong bit,
// since Stripe moved `current_period_end` off the Subscription object and onto each
// line item (see the comment on subscriptionPeriodEnd in src/lib/stripe.ts). None of
// these touch Stripe or the DB, so they run with zero env vars and no network.

import test from "node:test";
import assert from "node:assert/strict";
import { formatPricing } from "../format";
import { isPurchaseActive } from "../purchases";
import { subscriptionPeriodEnd } from "../stripe";
import type { Pricing } from "../types";
import type Stripe from "stripe";

// --- formatPricing -----------------------------------------------------------------

test("formatPricing renders Free for a free package regardless of model", () => {
  const pricing: Pricing = { model: "free", amountCents: 0, currency: "usd" };
  assert.equal(formatPricing(pricing), "Free");
});

test("formatPricing renders Free for a zero-amount package even if model isn't 'free'", () => {
  const pricing: Pricing = { model: "one-time", amountCents: 0, currency: "usd" };
  assert.equal(formatPricing(pricing), "Free");
});

test("formatPricing renders a plain price for one-time pricing", () => {
  const pricing: Pricing = { model: "one-time", amountCents: 500, currency: "usd" };
  assert.equal(formatPricing(pricing), "$5.00");
});

test("formatPricing appends /month for a monthly subscription", () => {
  const pricing: Pricing = { model: "subscription", amountCents: 500, currency: "usd", interval: "month" };
  assert.equal(formatPricing(pricing), "$5.00/month");
});

test("formatPricing appends /year for a yearly subscription", () => {
  const pricing: Pricing = { model: "subscription", amountCents: 5000, currency: "usd", interval: "year" };
  assert.equal(formatPricing(pricing), "$50.00/year");
});

test("formatPricing defaults a subscription with no interval to /month", () => {
  // Matches createCheckoutSession's own `pricing.interval ?? "month"` fallback — the
  // displayed price must never disagree with what a buyer is actually charged.
  const pricing: Pricing = { model: "subscription", amountCents: 500, currency: "usd" };
  assert.equal(formatPricing(pricing), "$5.00/month");
});

// --- isPurchaseActive ----------------------------------------------------------------

const NOW = new Date("2026-09-10T00:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date("2026-12-01T00:00:00Z");

test("isPurchaseActive is true for a perpetual (expiresAt null) paid purchase", () => {
  assert.equal(isPurchaseActive({ status: "paid", expiresAt: null }, NOW), true);
});

test("isPurchaseActive is true for a paid subscription whose period hasn't ended", () => {
  assert.equal(isPurchaseActive({ status: "paid", expiresAt: FUTURE }, NOW), true);
});

test("isPurchaseActive is false once expiresAt has passed, even if status is still 'paid'", () => {
  // The window between a failed renewal and Stripe firing customer.subscription.deleted:
  // status hasn't been touched yet, but the paid-through date already has.
  assert.equal(isPurchaseActive({ status: "paid", expiresAt: PAST }, NOW), false);
});

test("isPurchaseActive is false for any non-'paid' status regardless of expiresAt", () => {
  assert.equal(isPurchaseActive({ status: "cancelled", expiresAt: FUTURE }, NOW), false);
  assert.equal(isPurchaseActive({ status: "refunded", expiresAt: null }, NOW), false);
  assert.equal(isPurchaseActive({ status: "pending", expiresAt: null }, NOW), false);
});

test("isPurchaseActive treats an expiresAt exactly equal to now as expired", () => {
  assert.equal(isPurchaseActive({ status: "paid", expiresAt: NOW }, NOW), false);
});

// --- subscriptionPeriodEnd -----------------------------------------------------------

/** Builds just enough of a Stripe.Subscription to exercise subscriptionPeriodEnd —
 *  only `items.data[*].current_period_end` is ever read. */
function fakeSubscription(currentPeriodEndUnix: number | undefined): Stripe.Subscription {
  const items =
    currentPeriodEndUnix === undefined
      ? []
      : [{ current_period_end: currentPeriodEndUnix } as unknown as Stripe.SubscriptionItem];
  return {
    items: { data: items },
  } as unknown as Stripe.Subscription;
}

test("subscriptionPeriodEnd reads current_period_end off the first item, not the subscription itself", () => {
  const unixSeconds = 1_800_000_000; // 2027-01-15T08:00:00Z
  const subscription = fakeSubscription(unixSeconds);
  const result = subscriptionPeriodEnd(subscription);
  assert.ok(result instanceof Date);
  assert.equal(result?.getTime(), unixSeconds * 1000);
});

test("subscriptionPeriodEnd is null when the subscription has no items", () => {
  assert.equal(subscriptionPeriodEnd(fakeSubscription(undefined)), null);
});
