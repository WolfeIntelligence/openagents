import { NextRequest } from "next/server";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { deleteOrg, getMemberRole, getOrgByHandle, updateOrg } from "@/lib/orgs";
import type { Requester } from "@/lib/requester";

export const runtime = "nodejs";

const WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

async function canManage(requester: Requester | null, handle: string): Promise<boolean> {
  if (!requester) return false;
  const role = await getMemberRole(handle, requester.id);
  return role === "owner" || role === "admin";
}

// GET /api/v1/orgs/[handle] — public: profile fields, package count, and the
// full member list (it's a public org — members are visible to everyone).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const org = await getOrgByHandle(handle);
  if (!org) return error(404, `organization not found: ${handle}`);
  return json(org);
}

// PATCH /api/v1/orgs/[handle] { displayName?, bio?, website? } — owner/admin only.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  if (!isDbEnabled()) {
    return error(503, "organizations require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await canManage(requester, handle))) return error(403, "insufficient permissions");
  if (!hasScope(requester, "publish")) return error(403, "insufficient scope");

  const limited = rateLimit(`orgs:write:${requester.id}`, WRITE_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return error(400, "invalid body");
  const { displayName, bio, website } = body as { displayName?: unknown; bio?: unknown; website?: unknown };
  if (displayName !== undefined && typeof displayName !== "string") {
    return error(400, `"displayName" must be a string`);
  }
  if (bio !== undefined && bio !== null && typeof bio !== "string") {
    return error(400, `"bio" must be a string or null`);
  }
  if (website !== undefined && website !== null && typeof website !== "string") {
    return error(400, `"website" must be a string or null`);
  }

  const result = await updateOrg(handle, {
    displayName: displayName as string | undefined,
    bio: bio as string | null | undefined,
    website: website as string | null | undefined,
  });
  if (result === "invalid") return error(400, "invalid displayName, bio, or website");
  if (!result) return error(404, `organization not found: ${handle}`);
  return json(result);
}

// DELETE /api/v1/orgs/[handle] — owner only, refused (409) while it owns packages.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  if (!isDbEnabled()) {
    return error(503, "organizations require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  const role = await getMemberRole(handle, requester.id);
  if (role !== "owner") return error(403, "only an owner can delete this organization");

  const limited = rateLimit(`orgs:write:${requester.id}`, WRITE_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const result = await deleteOrg(handle);
  if (!result.ok) return error(result.status, result.message);
  return json({ ok: true });
}

export async function OPTIONS() {
  return preflight();
}
