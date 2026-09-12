import { NextRequest } from "next/server";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { getMemberRole, upsertMember } from "@/lib/orgs";

export const runtime = "nodejs";

const WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

// PUT /api/v1/orgs/[handle]/members { handle, role } — owner/admin only. Adds
// the named user (or updates their role if already a member). Refuses to
// demote the organization's last owner.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  if (!isDbEnabled()) {
    return error(503, "organizations require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  const actingRole = await getMemberRole(handle, requester.id);
  if (actingRole !== "owner" && actingRole !== "admin") {
    return error(403, "only an owner or admin can manage members");
  }
  if (!hasScope(requester, "publish")) return error(403, "insufficient scope");

  const limited = rateLimit(`orgs:write:${requester.id}`, WRITE_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { handle?: unknown }).handle !== "string" ||
    typeof (body as { role?: unknown }).role !== "string"
  ) {
    return error(400, `body must include string "handle" and "role"`);
  }
  const { handle: targetHandle, role } = body as { handle: string; role: string };

  const result = await upsertMember(handle, targetHandle, role);
  if (!result.ok) return error(result.status, result.message);
  return json({ members: result.members });
}

export async function OPTIONS() {
  return preflight();
}
