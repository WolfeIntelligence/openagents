import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { getCollection, removeItem } from "@/lib/collections";

export const runtime = "nodejs";

const WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

// DELETE /api/v1/collections/[handle]/[slug]/items/[owner]/[name] — owner or
// admin only.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string; slug: string; owner: string; name: string }> }
) {
  const { handle, slug, owner, name } = await params;
  if (!isDbEnabled()) {
    return error(503, "collections require a database; none is configured on this deployment");
  }

  const collection = await getCollection(handle, slug);
  if (!collection) return error(404, "collection not found");

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  const allowed = requester.id === collection.ownerUserId || (await isAdmin(requester));
  if (!allowed) return error(403, "insufficient permissions");

  const limited = rateLimit(`collections:write:${requester.id}`, WRITE_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const ok = await removeItem(collection.id, owner, name);
  if (!ok) return error(404, "item not in collection");
  return json({ ok: true });
}

export async function OPTIONS() {
  return preflight();
}
