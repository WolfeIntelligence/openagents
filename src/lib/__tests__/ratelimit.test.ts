// Pure-logic unit tests for `../ratelimit` — no Next.js imports, so this runs
// under plain Node instead of the Next test/build pipeline.
//
// Run with:
//   npx tsx --test src/lib/__tests__/ratelimit.test.ts
// or, if `tsx`'s `--test` integration isn't available in this Node version:
//   node --import tsx --test src/lib/__tests__/ratelimit.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit, clientIp } from "../ratelimit";

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
