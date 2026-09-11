import { NextRequest } from "next/server";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { createCollection, listCollections } from "@/lib/collections";

export const runtime = "nodejs";

// GET  /api/v1/collections?featured=1&owner=<handle>&q=<title>&limit=&offset=
//      Public collections, plus the caller's own private ones when `owner`
//      is the caller's own handle.
// POST /api/v1/collections { title, slug?, description?, isPublic? } — 201.
//
// 30 requests/min/user on the mutating endpoint only, same budget as the
// collection/item write routes below — see `WRITE_RATE_LIMIT`.
const WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

function parseIntParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner") ?? undefined;
  const featured = searchParams.get("featured") === "1";
  const q = searchParams.get("q") ?? undefined;
  const limit = parseIntParam(searchParams.get("limit"), 20);
  const offset = parseIntParam(searchParams.get("offset"), 0);

  // Only bother resolving the caller when `owner` is present — it's the only
  // case where identity changes the result (their own private collections).
  const requester = owner ? await getRequester(request) : null;
  const callerId = requester?.handle && requester.handle === owner ? requester.id : undefined;

  const result = await listCollections({
    owner,
    featured: featured || undefined,
    q,
    callerId,
    limit,
    offset,
  });
  return json(result);
}

export async function POST(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "collections require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in to create a collection");
  if (!hasScope(requester, "publish")) return error(403, "insufficient scope");

  const limited = rateLimit(`collections:write:${requester.id}`, WRITE_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as { title?: unknown }).title !== "string") {
    return error(400, "title is required");
  }
  const { title, slug, description, isPublic } = body as {
    title: string;
    slug?: unknown;
    description?: unknown;
    isPublic?: unknown;
  };

  if (slug !== undefined && typeof slug !== "string") return error(400, `"slug" must be a string`);
  if (description !== undefined && typeof description !== "string") {
    return error(400, `"description" must be a string`);
  }
  if (isPublic !== undefined && typeof isPublic !== "boolean") {
    return error(400, `"isPublic" must be a boolean`);
  }

  const result = await createCollection(requester, {
    title,
    slug: slug as string | undefined,
    description: description as string | undefined,
    isPublic: isPublic as boolean | undefined,
  });
  if (!result.ok) return error(result.status, result.message);
  return json(result.collection, { status: 201 });
}

export async function OPTIONS() {
  return preflight();
}
