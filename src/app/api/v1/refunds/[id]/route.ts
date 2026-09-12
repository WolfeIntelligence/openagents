import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { resolveRefundRequest, RefundError } from "@/lib/refunds";

export const runtime = "nodejs";

// POST /api/v1/refunds/[id] — { action: "approve" | "deny", note? }
//
// Seller (the owner of the package the refunded purchase belongs to) or
// admin only — `resolveRefundRequest` itself enforces the ownership check
// once it knows whether the caller is acting as admin; this route just
// resolves `isAdmin` and forwards the caller's handle either way. Admins use
// this same route (not a separate admin action route) per the Z4 contract —
// `/api/v1/admin/refunds` only adds the "list every request" view.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isDbEnabled()) {
    return error(503, "refunds require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  const actingAsAdmin = await isAdmin(requester);

  const body: unknown = await request.json().catch(() => null);
  const { action, note } = (body ?? {}) as { action?: unknown; note?: unknown };
  if (action !== "approve" && action !== "deny") {
    return error(400, `"action" must be "approve" or "deny"`);
  }
  if (note !== undefined && typeof note !== "string") {
    return error(400, `"note" must be a string`);
  }

  try {
    const result = await resolveRefundRequest({
      id,
      action,
      note,
      actorHandle: requester.handle,
      isAdminActor: actingAsAdmin,
    });
    return json(result);
  } catch (err) {
    if (err instanceof RefundError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function OPTIONS() {
  return preflight();
}
