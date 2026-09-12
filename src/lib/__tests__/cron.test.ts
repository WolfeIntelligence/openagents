// Pure-logic unit tests for `../cron` — no Next.js/DB imports, so this runs
// under plain Node instead of the Next test/build pipeline.
//
// Run with:
//   npx tsx --test src/lib/__tests__/cron.test.ts
// or, if `tsx`'s `--test` integration isn't available in this Node version:
//   node --import tsx --test src/lib/__tests__/cron.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCron, shouldSendReviewReminder, REVIEW_REMINDER_WINDOW_MS } from "../cron";

test("isAuthorizedCron accepts the exact bearer secret", () => {
  assert.equal(isAuthorizedCron("Bearer topsecret", "topsecret"), true);
});

test("isAuthorizedCron is case-insensitive about the 'Bearer' scheme", () => {
  assert.equal(isAuthorizedCron("bearer topsecret", "topsecret"), true);
  assert.equal(isAuthorizedCron("BEARER topsecret", "topsecret"), true);
});

test("isAuthorizedCron rejects a wrong secret", () => {
  assert.equal(isAuthorizedCron("Bearer wrong", "topsecret"), false);
});

test("isAuthorizedCron rejects a secret differing only in length", () => {
  assert.equal(isAuthorizedCron("Bearer topsecre", "topsecret"), false);
  assert.equal(isAuthorizedCron("Bearer topsecrett", "topsecret"), false);
});

test("isAuthorizedCron rejects a missing header", () => {
  assert.equal(isAuthorizedCron(null, "topsecret"), false);
  assert.equal(isAuthorizedCron(undefined, "topsecret"), false);
});

test("isAuthorizedCron rejects a non-bearer scheme", () => {
  assert.equal(isAuthorizedCron("Basic dG9wc2VjcmV0", "topsecret"), false);
});

test("isAuthorizedCron rejects when no secret is configured", () => {
  assert.equal(isAuthorizedCron("Bearer topsecret", undefined), false);
  assert.equal(isAuthorizedCron("Bearer topsecret", ""), false);
});

test("isAuthorizedCron never throws on malformed input", () => {
  assert.doesNotThrow(() => isAuthorizedCron("Bearer", "topsecret"));
  assert.doesNotThrow(() => isAuthorizedCron("", "topsecret"));
});

test("shouldSendReviewReminder sends when nothing was ever sent", () => {
  assert.equal(shouldSendReviewReminder(null), true);
});

test("shouldSendReviewReminder blocks a send within the throttle window", () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const lastSentAt = new Date(now.getTime() - 1000); // one second ago
  assert.equal(shouldSendReviewReminder(lastSentAt, now), false);
});

test("shouldSendReviewReminder allows a send once the window has fully elapsed", () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const lastSentAt = new Date(now.getTime() - REVIEW_REMINDER_WINDOW_MS - 1);
  assert.equal(shouldSendReviewReminder(lastSentAt, now), true);
});

test("shouldSendReviewReminder allows a send exactly at the window boundary", () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const lastSentAt = new Date(now.getTime() - REVIEW_REMINDER_WINDOW_MS);
  assert.equal(shouldSendReviewReminder(lastSentAt, now), true);
});

test("shouldSendReviewReminder blocks one millisecond before the boundary", () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const lastSentAt = new Date(now.getTime() - REVIEW_REMINDER_WINDOW_MS + 1);
  assert.equal(shouldSendReviewReminder(lastSentAt, now), false);
});
