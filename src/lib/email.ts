// Transactional email via Resend's HTTP API. No SDK — a plain `fetch`, so this stays a
// couple dozen lines and doesn't add a dependency for three request fields. Safe to
// import (and call) with zero env vars: `sendEmail` no-ops without RESEND_API_KEY, and
// never throws — every caller in src/lib/notify.ts is fire-and-forget and must not let
// a provider outage or bad network fail the action that triggered the notification.

import { formatPrice } from "@/lib/format";

const RESEND_API_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 5000;
const DEFAULT_FROM = "OpenAgents <noreply@openagents-nu.vercel.app>";

export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type SendEmailResult = { sent: true } | { sent: false; reason: string };

/**
 * Sends one email through Resend. Returns `{ sent: false, reason }` instead of
 * throwing for every failure mode (no API key, network error, timeout, non-2xx
 * response) — callers that just want "did this go out" can check `.sent`, and
 * nothing here ever needs a try/catch at the call site.
 */
export async function sendEmail({ to, subject, text, html }: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "RESEND_API_KEY not configured" };

  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: `resend responded ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    return { sent: true };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? `timed out after ${TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : "unknown error";
    return { sent: false, reason: `failed to reach resend: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Templates — small pure functions, each returning the three fields `sendEmail`
// needs. No DB/env access here, so they're unit-tested directly against fixed
// inputs in ./__tests__/email.test.ts.
// ---------------------------------------------------------------------------

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

/** Wraps a template's plain-text body in a minimal, email-client-safe HTML shell.
 *  Every template's `html` is derived from its `text` this way rather than hand-rolling
 *  markup twice per template — one wrong tag can't make the two versions disagree. */
function toHtml(paragraphs: string[]): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`)
    .join("\n");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;">${body}</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PurchaseReceiptInput {
  packageTitle: string;
  owner: string;
  name: string;
  amountCents: number;
  currency: string;
  installCommand: string;
  receiptUrl?: string | null;
}

/** Sent to the buyer right after a purchase completes. */
export function purchaseReceipt(input: PurchaseReceiptInput): EmailContent {
  const { packageTitle, owner, name, amountCents, currency, installCommand, receiptUrl } = input;
  const price = formatPrice(amountCents, currency);
  const lines = [
    `Thanks for your purchase of "${packageTitle}" (${owner}/${name}) for ${price}.`,
    `Install it with:\n\n  ${installCommand}`,
    receiptUrl ? `View your receipt: ${receiptUrl}` : undefined,
  ].filter((l): l is string => Boolean(l));

  return {
    subject: `Your receipt for ${owner}/${name}`,
    text: lines.join("\n\n"),
    html: toHtml(lines),
  };
}

export interface SaleNoticeInput {
  packageTitle: string;
  owner: string;
  name: string;
  netAmountCents: number;
  currency: string;
}

/** Sent to the seller when one of their packages sells. */
export function saleNotice(input: SaleNoticeInput): EmailContent {
  const { packageTitle, owner, name, netAmountCents, currency } = input;
  const net = formatPrice(netAmountCents, currency);
  const lines = [
    `"${packageTitle}" (${owner}/${name}) just sold.`,
    `Your share after the platform fee is ${net}. It'll show up in your Stripe payouts on its usual schedule.`,
  ];

  return {
    subject: `You made a sale: ${owner}/${name}`,
    text: lines.join("\n\n"),
    html: toHtml(lines),
  };
}

export interface ReportNoticeInput {
  owner: string;
  name: string;
  reason: string;
  details?: string | null;
  adminUrl: string;
}

/** Sent to admins when a package is reported. */
export function reportNotice(input: ReportNoticeInput): EmailContent {
  const { owner, name, reason, details, adminUrl } = input;
  const lines = [
    `${owner}/${name} was just reported for "${reason}".`,
    details ? `Details: ${details}` : undefined,
    `Review it in the admin queue: ${adminUrl}`,
  ].filter((l): l is string => Boolean(l));

  return {
    subject: `New report: ${owner}/${name}`,
    text: lines.join("\n\n"),
    html: toHtml(lines),
  };
}

export interface StatusNoticeInput {
  owner: string;
  name: string;
  status: string;
  message?: string | null;
  packageUrl: string;
}

/** Sent to a package's owner when its status changes (e.g. approved, rejected). */
export function statusNotice(input: StatusNoticeInput): EmailContent {
  const { owner, name, status, message, packageUrl } = input;
  const lines = [
    `${owner}/${name} is now "${status}".`,
    message ? `Note: ${message}` : undefined,
    `View it: ${packageUrl}`,
  ].filter((l): l is string => Boolean(l));

  return {
    subject: `${owner}/${name} is now ${status}`,
    text: lines.join("\n\n"),
    html: toHtml(lines),
  };
}
