import { NextRequest } from "next/server";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { OrgActionError, transferPackage } from "@/lib/orgs";

export const runtime = "nodejs";

// POST /api/v1/packages/[owner]/[name]/transfer { to: "<handle>" }
//
// Moves a package to a new owner: `to` must be an organization the caller is
// owner/admin of, or the caller's own user handle (moving a package they
// manage on behalf of an org back to personal ownership). See
// `src/lib/orgs.ts`'s `transferPackage`/`evaluateTransferEligibility` for the
// full rule and the multi-table rewrite this triggers.
//
// 5/min/user — tighter than most write routes since this rewrites several
// tables per call and has no legitimate reason to be called often.
const RATE_LIMIT = { limit: 5, windowMs: 60_000 };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "package transfer requires a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in to transfer this package");
  if (!hasScope(requester, "publish")) return error(403, "insufficient scope");

  const limited = rateLimit(`transfer:${requester.id}`, RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as { to?: unknown }).to !== "string") {
    return error(400, `body must include a string "to"`);
  }
  const { to } = body as { to: string };

  try {
    const result = await transferPackage(requester, owner, name, to);
    return json(result);
  } catch (err) {
    if (err instanceof OrgActionError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function OPTIONS() {
  return preflight();
}
