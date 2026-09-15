// Pure-logic unit tests for `../stripe`'s `canReceivePayments` — the one gate
// shared by the publish-time check (publish.ts) and the checkout-time lookup
// (createCheckoutSession), added so the two can't drift the way they used to
// (see the doc comment on `canReceivePayments` for the bug this replaced:
// publish-time checked the *publishing member's* personal Stripe account even
// for an org-owned package, while checkout looked up `users` by the package's
// owner handle — which is an organization's handle for an org-owned package,
// so it could never match a user row at all).
//
// Everything else in `../stripe` (resolveSellerAccount, createCheckoutSession,
// createConnectOnboardingLink, ...) talks to Postgres and the real Stripe SDK
// and isn't covered by this plain-Node suite — consistent with this
// codebase's existing convention (see docs/AUDIT-2026-09.md's "not exercised"
// list) of unit-testing the pure decision logic and leaving the DB/Stripe
// integration itself to manual/e2e testing.
//
// Run with: npm test (== node scripts/run-tests.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { canReceivePayments } from "../stripe";

test("canReceivePayments is false for null/undefined (no user or org row at all)", () => {
  assert.equal(canReceivePayments(null), false);
  assert.equal(canReceivePayments(undefined), false);
});

test("canReceivePayments is false with no connected account yet", () => {
  assert.equal(canReceivePayments({ stripeAccountId: null, stripeOnboarded: false }), false);
});

test("canReceivePayments is false mid-onboarding (account created, not yet onboarded)", () => {
  assert.equal(canReceivePayments({ stripeAccountId: "acct_123", stripeOnboarded: false }), false);
});

test("canReceivePayments is false for the impossible-but-defensive onboarded-with-no-account case", () => {
  assert.equal(canReceivePayments({ stripeAccountId: null, stripeOnboarded: true }), false);
});

test("canReceivePayments is true once an account exists and onboarding is complete", () => {
  assert.equal(canReceivePayments({ stripeAccountId: "acct_123", stripeOnboarded: true }), true);
});
