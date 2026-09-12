import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidRefundTransition,
  REFUND_STATUSES,
  refundEligibility,
  REFUND_WINDOW_DAYS,
  type RefundStatus,
} from "../refunds";

const NOW = new Date("2026-09-12T00:00:00.000Z");

function purchase(overrides: Partial<{ status: string; createdAt: Date; stripeSubscriptionId: string | null }> = {}) {
  return {
    status: "paid",
    createdAt: NOW,
    stripeSubscriptionId: null,
    ...overrides,
  };
}

test("refundEligibility: a freshly-paid one-time purchase is eligible", () => {
  const result = refundEligibility(purchase(), NOW);
  assert.equal(result.eligible, true);
});

test("refundEligibility: eligible right up to the edge of the window", () => {
  const createdAt = new Date(NOW.getTime() - REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000 + 1000);
  const result = refundEligibility(purchase({ createdAt }), NOW);
  assert.equal(result.eligible, true);
});

test("refundEligibility: not eligible once past the refund window", () => {
  const createdAt = new Date(NOW.getTime() - (REFUND_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
  const result = refundEligibility(purchase({ createdAt }), NOW);
  assert.equal(result.eligible, false);
  if (!result.eligible) {
    assert.match(result.reason, new RegExp(`${REFUND_WINDOW_DAYS} days`));
  }
});

test("refundEligibility: not eligible for a subscription purchase, regardless of age", () => {
  const result = refundEligibility(purchase({ stripeSubscriptionId: "sub_123" }), NOW);
  assert.equal(result.eligible, false);
  if (!result.eligible) {
    assert.match(result.reason, /billing portal/);
  }
});

test("refundEligibility: not eligible unless status is exactly 'paid'", () => {
  for (const status of ["pending", "failed", "refunded", "disputed", "cancelled"]) {
    const result = refundEligibility(purchase({ status }), NOW);
    assert.equal(result.eligible, false, `status "${status}" should not be eligible`);
  }
});

test("isValidRefundTransition: open can move to denied or refunded, never a no-op", () => {
  assert.equal(isValidRefundTransition("open", "denied"), true);
  assert.equal(isValidRefundTransition("open", "refunded"), true);
  assert.equal(isValidRefundTransition("open", "open"), false);
  assert.equal(isValidRefundTransition("open", "approved"), false);
});

test("isValidRefundTransition: denied and refunded are terminal", () => {
  for (const to of REFUND_STATUSES) {
    assert.equal(isValidRefundTransition("denied", to), false, `denied -> ${to}`);
    assert.equal(isValidRefundTransition("refunded", to), false, `refunded -> ${to}`);
  }
});

test("isValidRefundTransition: exhaustively matches the documented table", () => {
  const expected: Record<RefundStatus, RefundStatus[]> = {
    open: ["denied", "refunded"],
    approved: ["refunded"],
    denied: [],
    refunded: [],
  };
  for (const from of REFUND_STATUSES) {
    for (const to of REFUND_STATUSES) {
      assert.equal(
        isValidRefundTransition(from, to),
        expected[from].includes(to),
        `${from} -> ${to}`
      );
    }
  }
});
