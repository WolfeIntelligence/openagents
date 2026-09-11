import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequester } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { deleteAccount } from "@/lib/account";

export const runtime = "nodejs";

// DELETE /api/v1/account — { confirm: "<handle>" } must match the caller's own
// handle exactly. Session-only: a leaked API token must never be able to delete the
// account it belongs to, only a browser session with a human actually at the
// confirmation prompt. See src/lib/account.ts for the eligibility rules
// (deletionPlan) this delegates to.
const RATE_LIMIT = { limit: 5, windowMs: 60 * 60_000 };

const bodySchema = z.object({
  confirm: z.string().min(1),
});

export async function DELETE(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "account deletion requires a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) {
    return error(401, "unauthorized");
  }
  if (requester.via !== "session") {
    return error(403, "account deletion requires a browser session; a token cannot do this");
  }

  const limited = rateLimit(`account-delete:${requester.id}`, RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(400, `body must include a string "confirm" matching your handle`);
  }

  const result = await deleteAccount(requester.id, parsed.data.confirm);
  if (!result.ok) {
    return error(result.status, result.message);
  }

  return json({ deleted: true, anonymized: result.anonymized });
}

export async function OPTIONS() {
  return preflight();
}
