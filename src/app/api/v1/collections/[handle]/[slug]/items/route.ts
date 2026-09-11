import { NextRequest } from "next/server";
import { getRequester, hasScope } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { getCollection, upsertItem } from "@/lib/collections";

export const runtime = "nodejs";

const WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

// PUT /api/v1/collections/[handle]/[slug]/items { owner, name, note?, position? }
// — adds the package to the collection, or updates its note/position if it's
// already there. Owner or admin only; 404 if the package doesn't exist in the
// catalog; 400 past 100 items (MAX_COLLECTION_ITEMS in lib/collections.ts).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string; slug: string }> }
) {
  const { handle, slug } = await params;
  if (!isDbEnabled()) {
    return error(503, "collections require a database; none is configured on this deployment");
  }

  const collection = await getCollection(handle, slug);
  if (!collection) return error(404, "collection not found");

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  const allowed = requester.id === collection.ownerUserId || (await isAdmin(requester));
  if (!allowed) return error(403, "insufficient permissions");
  if (!hasScope(requester, "publish")) return error(403, "insufficient scope");

  const limited = rateLimit(`collections:write:${requester.id}`, WRITE_RATE_LIMIT);
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
    typeof (body as { owner?: unknown }).owner !== "string" ||
    typeof (body as { name?: unknown }).name !== "string"
  ) {
    return error(400, `"owner" and "name" are required strings`);
  }
  const { owner, name, note, position } = body as {
    owner: string;
    name: string;
    note?: unknown;
    position?: unknown;
  };

  if (note !== undefined && note !== null && typeof note !== "string") {
    return error(400, `"note" must be a string or null`);
  }
  if (position !== undefined && (typeof position !== "number" || !Number.isFinite(position))) {
    return error(400, `"position" must be a number`);
  }

  const result = await upsertItem(collection.id, {
    owner,
    name,
    note: note as string | null | undefined,
    position: position as number | undefined,
  });
  if (!result.ok) return error(result.status, result.message);
  return json({ items: result.items });
}

export async function OPTIONS() {
  return preflight();
}
