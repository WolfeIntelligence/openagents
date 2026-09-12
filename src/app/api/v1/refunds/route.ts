import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { withRateLimit } from "@/lib/ratelimit";
import { createRefundRequest, listRefundRequestsForBuyer, listRefundRequestsForSeller, RefundError } from "@/lib/refunds";

export const runtime = "nodejs";

// GET  /api/v1/refunds?mine=1   — the caller's own refund requests (buyer view).
// GET  /api/v1/refunds?seller=1 — refund requests on packages the caller owns.
// POST /api/v1/refunds { purchaseId, reason } — 201. 5/hour/user.
//
// Every verb here requires a signed-in caller (session or token — same
// `getRequester` every other route uses); there's no dedicated token scope
// for refunds, so any authenticated requester may act on their own purchases
// or their own packages, same as e.g. /api/v1/collections' owner-scoped reads.

// 5/hour/user, per the Z4 contract. Not added to `RATE_LIMITS` in
// src/lib/ratelimit.ts (not an owned file for this workstream) — `withRateLimit`
// accepts an inline `{ limit, windowMs }` just as well as a named budget.
const CREATE_RATE_LIMIT = { limit: 5, windowMs: 60 * 60_000 };

export async function GET(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "refunds require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");

  const { searchParams } = new URL(request.url);
  const mine = searchParams.get("mine") === "1";
  const seller = searchParams.get("seller") === "1";

  if (mine === seller) {
    return error(400, `pass exactly one of "?mine=1" or "?seller=1"`);
  }

  try {
    if (seller) {
      if (!requester.handle) return json({ items: [] });
      const items = await listRefundRequestsForSeller(requester.handle);
      return json({ items });
    }
    const items = await listRefundRequestsForBuyer(requester.id);
    return json({ items });
  } catch (err) {
    if (err instanceof RefundError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function POST(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "refunds require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");

  const limited = await withRateLimit(request, "refunds:create", {
    ...CREATE_RATE_LIMIT,
    key: `refunds:create:${requester.id}`,
    message: "too many refund requests, slow down",
  });
  if (limited) return limited;

  const body: unknown = await request.json().catch(() => null);
  const { purchaseId, reason } = (body ?? {}) as { purchaseId?: unknown; reason?: unknown };
  if (typeof purchaseId !== "string" || typeof reason !== "string") {
    return error(400, `body must include "purchaseId" and "reason" (both strings)`);
  }

  try {
    const result = await createRefundRequest({ userId: requester.id, purchaseId, reason });
    return json(result, { status: 201 });
  } catch (err) {
    if (err instanceof RefundError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function OPTIONS() {
  return preflight();
}
