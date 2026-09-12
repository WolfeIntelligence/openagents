import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { listAllRefundRequests, RefundError } from "@/lib/refunds";

export const runtime = "nodejs";

// GET /api/v1/admin/refunds — admin-only. Every refund request, newest first.
// Approve/deny actions go through POST /api/v1/refunds/[id] (same route the
// seller view uses) — this route is listing only.
export async function GET(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "admin actions require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await isAdmin(requester))) return error(403, "admin access required");

  try {
    const items = await listAllRefundRequests();
    return json({ items });
  } catch (err) {
    if (err instanceof RefundError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function OPTIONS() {
  return preflight();
}
