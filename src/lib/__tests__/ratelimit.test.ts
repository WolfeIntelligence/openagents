// Pure-logic unit tests for `../ratelimit` — no Next.js imports, so this runs
// under plain Node instead of the Next test/build pipeline.
//
// Run with:
//   npx tsx --test src/lib/__tests__/ratelimit.test.ts
// or, if `tsx`'s `--test` integration isn't available in this Node version:
//   node --import tsx --test src/lib/__tests__/ratelimit.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit, clientIp, fixedWindowResult, rateLimitDurable } from "../ratelimit";

test("allows up to the limit, then blocks", () => {
  const key = `test-${Math.random()}`;
  const opts = { limit: 3, windowMs: 60_000 };

  for (let i = 0; i < 3; i++) {
    const result = rateLimit(key, opts);
    assert.equal(result.ok, true, `call ${i + 1} should be allowed`);
    assert.equal(result.remaining, opts.limit - (i + 1));
  }

  const blocked = rateLimit(key, opts);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds >= 1, "retryAfterSeconds should be at least 1");
});

test("tracks independent keys separately", () => {
  const opts = { limit: 1, windowMs: 60_000 };
  const a = `a-${Math.random()}`;
  const b = `b-${Math.random()}`;

  assert.equal(rateLimit(a, opts).ok, true);
  assert.equal(rateLimit(a, opts).ok, false, "second call on the same key should be blocked");
  assert.equal(rateLimit(b, opts).ok, true, "a different key should have its own budget");
});

test("allows again once the window has fully elapsed", async () => {
  const key = `window-${Math.random()}`;
  const opts = { limit: 1, windowMs: 20 };

  assert.equal(rateLimit(key, opts).ok, true);
  assert.equal(rateLimit(key, opts).ok, false);

  await new Promise((resolve) => setTimeout(resolve, opts.windowMs + 10));

  assert.equal(rateLimit(key, opts).ok, true, "should be allowed again after the window passes");
});

test("retryAfterSeconds counts down as the window ages", async () => {
  const key = `retry-${Math.random()}`;
  const opts = { limit: 1, windowMs: 200 };

  rateLimit(key, opts);
  const first = rateLimit(key, opts);
  assert.equal(first.ok, false);

  await new Promise((resolve) => setTimeout(resolve, 100));

  const second = rateLimit(key, opts);
  assert.equal(second.ok, false);
  assert.ok(
    second.retryAfterSeconds <= first.retryAfterSeconds,
    "retryAfterSeconds should not increase as time passes"
  );
});

test("clientIp reads the first hop of x-forwarded-for", () => {
  const request = new Request("https://example.com", {
    headers: { "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" },
  });
  assert.equal(clientIp(request), "203.0.113.5");
});

test("clientIp falls back to x-real-ip when x-forwarded-for is absent", () => {
  const request = new Request("https://example.com", {
    headers: { "x-real-ip": "198.51.100.23" },
  });
  assert.equal(clientIp(request), "198.51.100.23");
});

test("clientIp falls back to \"unknown\" when neither header is present", () => {
  const request = new Request("https://example.com");
  assert.equal(clientIp(request), "unknown");
});

// --- fixedWindowResult (pure fixed-window math for rateLimitDurable) -------

test("fixedWindowResult allows when count is within the limit", () => {
  const now = Date.now();
  const result = fixedWindowResult(3, new Date(now), { limit: 5, windowMs: 60_000 }, now);
  assert.equal(result.ok, true);
  assert.equal(result.remaining, 2);
  assert.equal(result.retryAfterSeconds, 0);
});

test("fixedWindowResult allows exactly at the limit (count === limit)", () => {
  const now = Date.now();
  const result = fixedWindowResult(5, new Date(now), { limit: 5, windowMs: 60_000 }, now);
  assert.equal(result.ok, true);
  assert.equal(result.remaining, 0);
});

test("fixedWindowResult blocks once count exceeds the limit", () => {
  const now = Date.now();
  const windowStart = new Date(now - 10_000);
  const result = fixedWindowResult(6, windowStart, { limit: 5, windowMs: 60_000 }, now);
  assert.equal(result.ok, false);
  assert.equal(result.remaining, 0);
  // 60s window, 10s elapsed => 50s left, rounded up.
  assert.equal(result.retryAfterSeconds, 50);
});

test("fixedWindowResult never returns retryAfterSeconds below 1 when blocked", () => {
  const now = Date.now();
  // windowStart + windowMs is in the past relative to `now` (window already
  // expired by the time we're computing this) — still must report >= 1s.
  const windowStart = new Date(now - 120_000);
  const result = fixedWindowResult(10, windowStart, { limit: 5, windowMs: 60_000 }, now);
  assert.equal(result.ok, false);
  assert.ok(result.retryAfterSeconds >= 1);
});

// --- rateLimitDurable fallback (DB off) ------------------------------------
//
// These tests run with DATABASE_URL unset (the default in this environment),
// so `rateLimitDurable` must silently behave exactly like the in-memory
// `rateLimit` it wraps — no throw, no hang, no attempt to reach a database.

test("rateLimitDurable falls back to in-memory limiting when the DB is off", async () => {
  assert.equal(process.env.DATABASE_URL, undefined, "test assumes no DATABASE_URL is set");

  const key = `durable-fallback-${Math.random()}`;
  const opts = { limit: 2, windowMs: 60_000 };

  assert.equal((await rateLimitDurable(key, opts)).ok, true);
  assert.equal((await rateLimitDurable(key, opts)).ok, true);
  const blocked = await rateLimitDurable(key, opts);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test("rateLimitDurable fallback tracks keys independently, like rateLimit", async () => {
  const opts = { limit: 1, windowMs: 60_000 };
  const a = `durable-a-${Math.random()}`;
  const b = `durable-b-${Math.random()}`;

  assert.equal((await rateLimitDurable(a, opts)).ok, true);
  assert.equal((await rateLimitDurable(a, opts)).ok, false);
  assert.equal((await rateLimitDurable(b, opts)).ok, true);
});
