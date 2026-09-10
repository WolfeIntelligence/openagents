// Run with: npx tsx --test src/lib/__tests__/format.test.ts
// (or compile with tsc first and run with `node --test`). Imports only
// src/lib/format.ts — no Next.js runtime, DB, or Stripe involved.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ZERO_DECIMAL_CURRENCIES,
  isZeroDecimal,
  isSupportedCurrency,
  formatPrice,
} from "../format";

test("isZeroDecimal matches Stripe's zero-decimal list, case-insensitively", () => {
  assert.equal(isZeroDecimal("jpy"), true);
  assert.equal(isZeroDecimal("JPY"), true);
  assert.equal(isZeroDecimal("usd"), false);
  assert.equal(ZERO_DECIMAL_CURRENCIES.has("krw"), true);
});

test("isSupportedCurrency accepts only three lowercase letters", () => {
  assert.equal(isSupportedCurrency("usd"), true);
  assert.equal(isSupportedCurrency("USD"), false);
  assert.equal(isSupportedCurrency("us"), false);
  assert.equal(isSupportedCurrency("usdd"), false);
  assert.equal(isSupportedCurrency(""), false);
});

test("formatPrice divides by 100 for a normal currency", () => {
  assert.equal(formatPrice(500, "usd"), "$5.00");
});

test("formatPrice does not divide for a zero-decimal currency", () => {
  assert.equal(formatPrice(500, "jpy"), "¥500");
});

test("formatPrice falls back to a plain string when Intl rejects the currency code", () => {
  // Intl.NumberFormat throws a RangeError for a code that isn't shaped like a real
  // ISO 4217 alpha-3 currency (e.g. wrong length) — that's the case this fallback
  // exists for. A well-formed-but-unrecognized 3-letter code (e.g. "zzz") doesn't
  // throw; Intl just renders the code itself in place of a symbol.
  const result = formatPrice(500, "xx");
  assert.equal(result, "5.00 XX");
});
