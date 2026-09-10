import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { isReviewRequired, PackageActionError, setPackageFeatured, setPackageStatus } from "@/lib/moderation";

export const runtime = "nodejs";

// POST /api/v1/admin/packages/[owner]/[name] — admin-only.
//   { status?: "live" | "unlisted" | "deprecated", featured?: boolean, reason?: string }
//
// `status: "live"` from "pending" is an approve; `status: "unlisted"` from
// "pending" with a `reason` is a reject — both go through the same
// `setPackageStatus` the owner-facing status route uses, with `isAdmin: true`
// so the pending->live gate never applies here. `featured` is independent and
// may be set with or without `status` in the same call.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "admin actions require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await isAdmin(requester))) return error(403, "admin access required");

  const body: unknown = await request.json().catch(() => null);
  const { status, featured, reason } = (body ?? {}) as {
    status?: unknown;
    featured?: unknown;
    reason?: unknown;
  };

  if (status === undefined && featured === undefined) {
    return error(400, `body must include "status" and/or "featured"`);
  }
  if (status !== undefined && typeof status !== "string") {
    return error(400, `"status" must be a string`);
  }
  if (featured !== undefined && typeof featured !== "boolean") {
    return error(400, `"featured" must be a boolean`);
  }

  try {
    let result: { id: string; status?: string; featured?: boolean } = { id: `${owner}/${name}` };

    if (typeof status === "string") {
      const statusResult = await setPackageStatus({
        owner,
        name,
        status,
        message: typeof reason === "string" ? reason : undefined,
        isAdmin: true,
        requireReview: isReviewRequired(),
      });
      result = { ...result, status: statusResult.status };
    }

    if (typeof featured === "boolean") {
      const featuredResult = await setPackageFeatured(owner, name, featured);
      result = { ...result, featured: featuredResult.featured };
    }

    return json(result);
  } catch (err) {
    if (err instanceof PackageActionError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function OPTIONS() {
  return preflight();
}
