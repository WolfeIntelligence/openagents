import { NextRequest } from "next/server";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { buildAccountExport } from "@/lib/account";

export const runtime = "nodejs";

// GET /api/v1/account/export — session, or a token with the "read" scope. Returns
// everything "download my data" ought to cover for the caller's own account as a
// single JSON file attachment. Rate-limited harder than a typical read endpoint:
// it's one of the heavier queries in the app (several joined tables) and there's
// no legitimate reason to call it more than a handful of times an hour.
const RATE_LIMIT = { limit: 5, windowMs: 60 * 60_000 };

export async function GET(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "account export requires a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) {
    return error(401, "unauthorized");
  }
  if (!hasScope(requester, "read")) {
    return error(403, "this token doesn't have the \"read\" scope");
  }

  const limited = rateLimit(`account-export:${requester.id}`, RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const data = await buildAccountExport(requester.id);
  if (!data) {
    return error(404, "account not found");
  }

  return json(data, {
    headers: { "Content-Disposition": 'attachment; filename="openagents-export.json"' },
  });
}

export async function OPTIONS() {
  return preflight();
}
