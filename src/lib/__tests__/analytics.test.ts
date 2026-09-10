// Pure-logic unit tests for the install-analytics helpers (`../analytics`) and the
// net-revenue math they feed (`../stripe`). Both modules degrade harmlessly with zero
// env vars — nothing here touches a database or Stripe — so this runs under plain
// Node, same as the other `src/lib/__tests__/*.test.ts` files.
//
// Run with: npm test (== node scripts/run-tests.mjs)

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { utcDay, clientHash, fillDailySeries } from "../analytics";
import { platformFeeCents, netRevenueCents, PLATFORM_FEE_BPS } from "../stripe";

describe("utcDay", () => {
  test("formats a Date as YYYY-MM-DD in UTC", () => {
    assert.equal(utcDay(new Date("2026-09-10T00:00:00.000Z")), "2026-09-10");
    assert.equal(utcDay(new Date("2026-09-10T23:59:59.999Z")), "2026-09-10");
  });

  test("a UTC day boundary crossing does not leak into the neighboring day", () => {
    assert.equal(utcDay(new Date("2026-01-01T00:00:00.000Z")), "2026-01-01");
    assert.equal(utcDay(new Date("2025-12-31T23:59:59.999Z")), "2025-12-31");
  });
});

describe("clientHash", () => {
  test("is stable for the same ip and day", () => {
    const day = "2026-09-10";
    assert.equal(clientHash("203.0.113.5", day), clientHash("203.0.113.5", day));
  });

  test("differs across days for the same ip (no cross-day joins)", () => {
    const a = clientHash("203.0.113.5", "2026-09-10");
    const b = clientHash("203.0.113.5", "2026-09-11");
    assert.notEqual(a, b);
  });

  test("differs across ips for the same day", () => {
    const day = "2026-09-10";
    const a = clientHash("203.0.113.5", day);
    const b = clientHash("198.51.100.23", day);
    assert.notEqual(a, b);
  });

  test("is a hex sha256 digest (64 chars)", () => {
    assert.match(clientHash("203.0.113.5", "2026-09-10"), /^[0-9a-f]{64}$/);
  });
});

describe("fillDailySeries", () => {
  test("produces exactly `days` entries ending on the given day, oldest first", () => {
    const end = new Date("2026-09-10T12:00:00.000Z");
    const series = fillDailySeries([], 5, end);
    assert.deepEqual(
      series.map((d) => d.day),
      ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]
    );
  });

  test("fills days with no rows as zero", () => {
    const end = new Date("2026-09-10T00:00:00.000Z");
    const series = fillDailySeries([{ day: "2026-09-09", count: 3 }], 3, end);
    assert.deepEqual(series, [
      { day: "2026-09-08", count: 0 },
      { day: "2026-09-09", count: 3 },
      { day: "2026-09-10", count: 0 },
    ]);
  });

  test("works with zero data — an all-zero series, not an empty one", () => {
    const series = fillDailySeries([], 7);
    assert.equal(series.length, 7);
    assert.ok(series.every((d) => d.count === 0));
  });

  test("ignores rows outside the requested window", () => {
    const end = new Date("2026-09-10T00:00:00.000Z");
    const series = fillDailySeries([{ day: "2026-08-01", count: 99 }], 3, end);
    assert.ok(series.every((d) => d.count === 0));
  });
});

describe("net revenue math", () => {
  test("platformFeeCents at the default 10% (1000 bps)", () => {
    assert.equal(PLATFORM_FEE_BPS, 1000);
    assert.equal(platformFeeCents(1000), 100);
    assert.equal(platformFeeCents(999), 100); // rounds to nearest cent
  });

  test("netRevenueCents is gross minus the fee", () => {
    assert.equal(netRevenueCents(1000), 900);
    assert.equal(netRevenueCents(1500), 1350);
  });

  test("fee and net always add back up to the gross amount", () => {
    for (const gross of [0, 1, 99, 100, 501, 999, 12345]) {
      assert.equal(platformFeeCents(gross) + netRevenueCents(gross), gross);
    }
  });

  test("a custom fee rate overrides the platform default", () => {
    assert.equal(platformFeeCents(1000, 2500), 250); // 25%
    assert.equal(netRevenueCents(1000, 2500), 750);
    assert.equal(netRevenueCents(1000, 0), 1000); // no fee at all
  });
});
