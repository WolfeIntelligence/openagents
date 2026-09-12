import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { PackageActionError, deletePackage, isReviewRequired, setPackageStatus } from "@/lib/moderation";
import { notifyPackageStatusChanged } from "@/lib/notify";
import { isPackageOwner } from "@/lib/access";

export const runtime = "nodejs";

// POST /api/v1/packages/[owner]/[name]/status — owner or admin only.
//   { status: "live" | "unlisted" | "deprecated", message?, replacementId? }
//   { action: "delete" }
//
// Keyed by the caller's id rather than IP: this route is already
// authenticated, and an id-keyed bucket doesn't over-penalize several owners
// behind the same NAT/proxy the way an IP-keyed one would.
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "package moderation requires a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in to manage this package");

  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);
  if (!pkg) return error(404, `package not found: ${owner}/${name}`);
  if (pkg.source === "seed") {
    return error(400, "seed packages can't be modified here; they live in git");
  }

  const admin = await isAdmin(requester);
  const isOwner = await isPackageOwner(requester, pkg);
  if (!isOwner && !admin) {
    return error(403, "only the package owner or an admin can do this");
  }

  const limited = rateLimit(`pkg-status:${requester.id}`, RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return error(400, `body must include "status" or {"action":"delete"}`);
  }

  try {
    if ((body as { action?: unknown }).action === "delete") {
      const result = await deletePackage(owner, name);
      return json(result);
    }

    const { status, message, replacementId } = body as {
      status?: unknown;
      message?: unknown;
      replacementId?: unknown;
    };
    if (typeof status !== "string") {
      return error(400, `body must include "status" or {"action":"delete"}`);
    }

    const result = await setPackageStatus({
      owner,
      name,
      status,
      message: typeof message === "string" ? message : undefined,
      replacementId: typeof replacementId === "string" ? replacementId : undefined,
      isAdmin: admin,
      requireReview: isReviewRequired(),
    });
    // Owners acting on their own package already know; only tell them when an admin
    // changed it for them.
    if (admin) {
      void notifyPackageStatusChanged({
        owner,
        name,
        status: result.status,
        message: typeof message === "string" ? message : null,
      });
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
