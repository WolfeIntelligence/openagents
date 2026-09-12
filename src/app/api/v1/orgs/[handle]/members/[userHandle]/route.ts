import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { getMemberRole, removeMember } from "@/lib/orgs";

export const runtime = "nodejs";

const WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

// DELETE /api/v1/orgs/[handle]/members/[userHandle] — an owner/admin removing
// someone else, or a member removing themselves. The organization's last
// owner can't be removed (by anyone, including themselves) — promote another
// member to owner first.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string; userHandle: string }> }
) {
  const { handle, userHandle } = await params;
  if (!isDbEnabled()) {
    return error(503, "organizations require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");

  const actingRole = await getMemberRole(handle, requester.id);
  const isSelf = requester.handle === userHandle;
  if (actingRole !== "owner" && actingRole !== "admin" && !isSelf) {
    return error(403, "only an owner, admin, or the member themselves can do this");
  }

  const limited = rateLimit(`orgs:write:${requester.id}`, WRITE_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const result = await removeMember(handle, userHandle);
  if (!result.ok) return error(result.status, result.message);
  return json({ ok: true });
}

export async function OPTIONS() {
  return preflight();
}
