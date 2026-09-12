// Shared plumbing for `/api/cron/*` routes (Z5): auth (Vercel Cron calls these with
// `Authorization: Bearer ${CRON_SECRET}`) and the review-reminder throttle decision.
// Both are pure/synchronous where possible so they're unit-tested directly (see
// ./__tests__/cron.test.ts) without a database or a real HTTP request.
//
// Safe to import with zero env vars: `requireCronAuth` degrades to a 503 (rather
// than crashing or, worse, accepting any caller) when CRON_SECRET is unset.

import { timingSafeEqual } from "node:crypto";

const BEARER_RE = /^bearer\s+(.+)$/i;

/**
 * True when `header` (the raw `Authorization` header value) carries exactly the
 * bearer token `secret`. Constant-time comparison so a timing side-channel can't
 * leak how much of the secret matched. False (never throws) for a missing
 * header, a non-bearer scheme, an unset `secret`, or a length mismatch — the
 * length check has to happen before `timingSafeEqual`, which throws (rather
 * than returning false) when its two buffers differ in length.
 */
export function isAuthorizedCron(header: string | null | undefined, secret: string | undefined | null): boolean {
  if (!header || !secret) return false;
  const match = BEARER_RE.exec(header.trim());
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Full auth gate for a cron route handler: call at the top and `return` the
 * result if non-null.
 *
 *   const denied = requireCronAuth(request);
 *   if (denied) return denied;
 *
 * 503 when `CRON_SECRET` isn't configured on this deployment (a misconfigured
 * cron should fail loudly rather than silently accepting every caller — or,
 * the opposite mistake, silently accepting none forever with no way to tell
 * why), 401 when the header doesn't match, `null` (proceed) otherwise.
 */
export function requireCronAuth(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Review-reminder throttling (used by /api/cron/review-reminders)
// ---------------------------------------------------------------------------

/** 23h, not 24h: a slightly early cron invocation (clock drift, a retried run)
 *  still only sends once per calendar day, without an early run pushing the
 *  next allowed send a full extra day later than intended. */
export const REVIEW_REMINDER_WINDOW_MS = 23 * 60 * 60 * 1000;

/**
 * True when a review-reminder email should be sent: no prior send recorded
 * (`lastSentAt` null) or the last one was more than `REVIEW_REMINDER_WINDOW_MS`
 * ago. Pure — the caller resolves `lastSentAt` from wherever it records the last
 * send (the `rate_limits` row keyed `cron:review-reminders`; see
 * src/app/api/cron/review-reminders/route.ts) and records a fresh send itself
 * when this returns true.
 */
export function shouldSendReviewReminder(lastSentAt: Date | null, now: Date = new Date()): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= REVIEW_REMINDER_WINDOW_MS;
}
