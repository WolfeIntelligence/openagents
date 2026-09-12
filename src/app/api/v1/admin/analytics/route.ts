import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { getAdminAnalytics } from "@/app/admin/analytics/data";

export const runtime = "nodejs";

const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

// GET /api/v1/admin/analytics?days=30 — admin-only. Same numbers/series the
// /admin/analytics page renders (see src/app/admin/analytics/data.ts), as JSON.
export async function GET(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "admin analytics requires a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await isAdmin(requester))) return error(403, "admin access required");

  const daysParam = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), MAX_DAYS) : DEFAULT_DAYS;

  try {
    const analytics = await getAdminAnalytics(days);
    if (!analytics) return error(503, "temporarily unavailable; try again shortly");
    return json(analytics);
  } catch (err) {
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function OPTIONS() {
  return preflight();
}
