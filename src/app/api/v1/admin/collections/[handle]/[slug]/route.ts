import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { getCollection, updateCollection } from "@/lib/collections";

export const runtime = "nodejs";

// POST /api/v1/admin/collections/[handle]/[slug] { featured: boolean } — admin-only.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string; slug: string }> }
) {
  const { handle, slug } = await params;
  if (!isDbEnabled()) {
    return error(503, "admin actions require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await isAdmin(requester))) return error(403, "admin access required");

  const collection = await getCollection(handle, slug);
  if (!collection) return error(404, "collection not found");

  const body: unknown = await request.json().catch(() => null);
  const featured = (body as { featured?: unknown } | null)?.featured;
  if (typeof featured !== "boolean") return error(400, `"featured" must be a boolean`);

  const result = await updateCollection(collection.id, { featured });
  if (!result || result === "conflict") return error(500, "failed to update collection");
  return json(result);
}

export async function OPTIONS() {
  return preflight();
}
