import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { listQueue, PackageActionError } from "@/lib/moderation";

export const runtime = "nodejs";

// GET /api/v1/admin/queue — admin-only. Pending packages + open reports.
export async function GET(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "the admin queue requires a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await isAdmin(requester))) return error(403, "admin access required");

  try {
    const queue = await listQueue();
    return json(queue);
  } catch (err) {
    if (err instanceof PackageActionError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function OPTIONS() {
  return preflight();
}
