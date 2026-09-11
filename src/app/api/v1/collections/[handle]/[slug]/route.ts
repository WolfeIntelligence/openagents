import { NextRequest } from "next/server";
import { getRequester, hasScope } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { deleteCollection, getCollection, isValidSlug, updateCollection } from "@/lib/collections";
import type { Requester } from "@/lib/requester";
import type { CollectionDetail } from "@/lib/collections";

export const runtime = "nodejs";

const WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

async function canManage(requester: Requester | null, collection: CollectionDetail): Promise<boolean> {
  if (!requester) return false;
  if (requester.id === collection.ownerUserId) return true;
  return isAdmin(requester);
}

// GET /api/v1/collections/[handle]/[slug] — the collection plus its ordered
// items. A private collection 404s for anyone but its owner or an admin —
// same "don't confirm it exists" shape as /admin.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string; slug: string }> }
) {
  const { handle, slug } = await params;
  const collection = await getCollection(handle, slug);
  if (!collection) return error(404, "collection not found");

  if (!collection.isPublic) {
    const requester = await getRequester(request);
    if (!(await canManage(requester, collection))) return error(404, "collection not found");
  }

  return json(collection);
}

// PATCH /api/v1/collections/[handle]/[slug] { title?, description?, isPublic?, slug? }
// — owner or admin only.
export async function PATCH(
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
  if (!(await canManage(requester, collection))) return error(403, "insufficient permissions");
  if (!hasScope(requester, "publish")) return error(403, "insufficient scope");

  const limited = rateLimit(`collections:write:${requester.id}`, WRITE_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return error(400, "invalid body");
  const { title, description, isPublic, slug: newSlug } = body as {
    title?: unknown;
    description?: unknown;
    isPublic?: unknown;
    slug?: unknown;
  };

  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    return error(400, `"title" must be a non-empty string`);
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return error(400, `"description" must be a string or null`);
  }
  if (isPublic !== undefined && typeof isPublic !== "boolean") {
    return error(400, `"isPublic" must be a boolean`);
  }
  if (newSlug !== undefined && (typeof newSlug !== "string" || !isValidSlug(newSlug))) {
    return error(400, "slug must match ^[a-z0-9-]{2,64}$");
  }

  const result = await updateCollection(collection.id, {
    title: title as string | undefined,
    description: description as string | null | undefined,
    isPublic: isPublic as boolean | undefined,
    slug: newSlug as string | undefined,
  });
  if (result === "conflict") {
    return error(409, `a collection with slug "${String(newSlug)}" already exists`);
  }
  if (!result) return error(500, "failed to update collection");
  return json(result);
}

// DELETE /api/v1/collections/[handle]/[slug] — owner or admin only.
export async function DELETE(
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
  if (!(await canManage(requester, collection))) return error(403, "insufficient permissions");

  const limited = rateLimit(`collections:write:${requester.id}`, WRITE_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const ok = await deleteCollection(collection.id);
  if (!ok) return error(500, "failed to delete collection");
  return json({ ok: true });
}

export async function OPTIONS() {
  return preflight();
}
