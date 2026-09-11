// Currency formatting shared by every purchase-facing surface (pricing badges, the buy
// button label, purchase history, payout totals). Dependency-free so it's safe to
// import from client components as well as server code.

import type { Pricing } from "@/lib/types";

/** Stripe's zero-decimal currencies: `amountCents` for these is already a whole unit
 *  (e.g. amountCents=500 for JPY means ¥500, not ¥5.00 — there's no minor unit). */
export const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase());
}

/** ISO-4217-shaped currency code (three lowercase letters) — the minimal check
 *  `createCheckoutSession` applies before handing a code to Stripe. Not a whitelist of
 *  currencies Stripe actually supports; Stripe itself is the source of truth for that. */
export function isSupportedCurrency(code: string): boolean {
  return /^[a-z]{3}$/.test(code);
}

/** Formats a purchase amount for display. `amountCents` is in the smallest unit Stripe
 *  uses for `currency` — cents for most currencies, whole units for zero-decimal ones.
 *  Falls back to a plain "5.00 USD"-style string if `Intl.NumberFormat` doesn't
 *  recognize `currency` (e.g. one Stripe added after this shipped), rather than
 *  throwing and taking down the page it's rendered on. */
export function formatPrice(amountCents: number, currency: string): string {
  const upper = currency.toUpperCase();
  const amount = isZeroDecimal(currency) ? amountCents : amountCents / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: upper }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${upper}`;
  }
}

/** Formats a package's price for display, appending a billing-period suffix for
 *  subscriptions (`"$5.00/month"`, `"$50.00/year"`). Free packages (by model or a
 *  zero amount) always render as "Free" regardless of model. A subscription with no
 *  `interval` set falls back to "month" — the same default `createCheckoutSession`
 *  uses, so the displayed price always matches what a buyer is actually charged. */
export function formatPricing(pricing: Pricing): string {
  if (pricing.model === "free" || pricing.amountCents === 0) return "Free";
  const amount = formatPrice(pricing.amountCents, pricing.currency);
  if (pricing.model === "subscription") {
    return `${amount}/${pricing.interval ?? "month"}`;
  }
  return amount;
}
