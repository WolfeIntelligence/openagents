import { NextRequest } from "next/server";
import { error, preflight } from "@/lib/api";
import { PATCH as patchWithBodyId } from "../route";

export const runtime = "nodejs";

// PATCH /api/v1/packages/[owner]/[name]/advisories/[id] — the documented,
// URL-addressed form. The collection route accepts the same edit with the id in
// the body; this just lifts the id out of the path so both shapes behave
// identically (same auth, validation, and response).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string; id: string }> }
) {
  const { id } = await params;
  if (!id) return error(400, "advisory id is required");

  const body: unknown = await request.json().catch(() => null);
  if (body !== null && (typeof body !== "object" || Array.isArray(body))) {
    return error(400, "body must be a JSON object");
  }
  const merged = { ...((body as Record<string, unknown> | null) ?? {}), id };

  const forwarded = new NextRequest(request.url, {
    method: "PATCH",
    headers: request.headers,
    body: JSON.stringify(merged),
  });
  return patchWithBodyId(forwarded);
}

export async function OPTIONS() {
  return preflight();
}
