import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { PackageActionError, resolveReport } from "@/lib/moderation";

export const runtime = "nodejs";

// POST /api/v1/admin/reports/[id] — admin-only. { status: "resolved" | "dismissed" }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isDbEnabled()) {
    return error(503, "admin actions require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await isAdmin(requester))) return error(403, "admin access required");

  const body: unknown = await request.json().catch(() => null);
  const { status } = (body ?? {}) as { status?: unknown };
  if (typeof status !== "string") {
    return error(400, `body must include "status"`);
  }

  try {
    const result = await resolveReport(id, status);
    return json(result);
  } catch (err) {
    if (err instanceof PackageActionError) return error(err.status, err.message);
    throw err;
  }
}

export async function OPTIONS() {
  return preflight();
}
