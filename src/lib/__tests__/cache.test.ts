// Pure-logic unit tests for `../catalog/cache` — no Next.js/DB imports, so
// this runs under plain Node instead of the Next test/build pipeline.
//
// Run with:
//   npx tsx --test src/lib/__tests__/cache.test.ts
// or, if `tsx`'s `--test` integration isn't available in this Node version:
//   node --import tsx --test src/lib/__tests__/cache.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { cached, invalidateCatalogCache } from "../catalog/cache";

function uniqueKey(label: string): string {
  return `${label}-${Math.random()}`;
}

test("caches a value for the TTL, calling fn only once", async () => {
  const key = uniqueKey("ttl");
  let calls = 0;
  const fn = async () => {
    calls++;
    return "value";
  };

  assert.equal(await cached(key, 60_000, fn), "value");
  assert.equal(await cached(key, 60_000, fn), "value");
  assert.equal(await cached(key, 60_000, fn), "value");
  assert.equal(calls, 1, "fn should only run on the first call within the TTL");
});

test("evicts once the TTL elapses, calling fn again", async () => {
  const key = uniqueKey("evict");
  let calls = 0;
  const fn = async () => {
    calls++;
    return calls;
  };

  assert.equal(await cached(key, 20, fn), 1);
  assert.equal(await cached(key, 20, fn), 1, "still within the TTL");

  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(await cached(key, 20, fn), 2, "fn should re-run once the TTL has elapsed");
});

test("tracks independent keys separately", async () => {
  const keyA = uniqueKey("a");
  const keyB = uniqueKey("b");
  let callsA = 0;
  let callsB = 0;

  await cached(keyA, 60_000, async () => {
    callsA++;
    return "a";
  });
  await cached(keyB, 60_000, async () => {
    callsB++;
    return "b";
  });
  await cached(keyA, 60_000, async () => {
    callsA++;
    return "a";
  });

  assert.equal(callsA, 1, "key A's fn should only run once");
  assert.equal(callsB, 1, "key B's fn should only run once");
});

test("concurrent calls for the same key share one in-flight fetch", async () => {
  const key = uniqueKey("concurrent");
  let calls = 0;
  const fn = () =>
    new Promise<string>((resolve) => {
      calls++;
      setTimeout(() => resolve("value"), 20);
    });

  const [a, b, c] = await Promise.all([
    cached(key, 60_000, fn),
    cached(key, 60_000, fn),
    cached(key, 60_000, fn),
  ]);

  assert.deepEqual([a, b, c], ["value", "value", "value"]);
  assert.equal(calls, 1, "a burst of concurrent calls should fan out into one fetch, not N");
});

test("a rejected fetch is not cached — the next call retries", async () => {
  const key = uniqueKey("reject");
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return "recovered";
  };

  await assert.rejects(() => cached(key, 60_000, fn), /boom/);
  assert.equal(await cached(key, 60_000, fn), "recovered");
  assert.equal(calls, 2, "the failed first call should not have poisoned the cache");
});

test("invalidateCatalogCache clears every key immediately, even within its TTL", async () => {
  const key = uniqueKey("invalidate");
  let calls = 0;
  const fn = async () => {
    calls++;
    return calls;
  };

  assert.equal(await cached(key, 60_000, fn), 1);
  invalidateCatalogCache();
  assert.equal(await cached(key, 60_000, fn), 2, "fn should re-run after invalidation");
});
