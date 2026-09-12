import { NextRequest } from "next/server";
import { z } from "zod";
import { getCatalog } from "@/lib/catalog";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight, withCors } from "@/lib/api";
import { getRequester, hasScope } from "@/lib/requester";
import {
  clampReviewsLimit,
  clampReviewsOffset,
  deleteReview,
  getReviewsPage,
  normalizeReviewSort,
  upsertReview,
} from "@/lib/reviews";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// GET    /api/v1/packages/[owner]/[name]/reviews — list reviews, newest first,
//        plus the live average/count (G-R2).
// PUT    /api/v1/packages/[owner]/[name]/reviews — create or update the caller's
//        own review (one per user per package, enforced by the unique
//        constraint; owners may not review their own package).
// DELETE /api/v1/packages/[owner]/[name]/reviews — remove the caller's own review.

// 10 requests/min/user on the mutating endpoint, matching the contract. Keyed by
// requester id rather than IP: PUT always requires auth, so a stable per-user key
// is available and fairer than pooling every signed-in caller behind one IP.
const PUT_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

const putBodySchema = z.object({
  rating: z.number(),
  body: z.string().max(2000).optional(),
});

async function resolvePackage(owner: string, name: string) {
  const catalog = await getCatalog();
  return catalog.get(owner, name);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!(await resolvePackage(owner, name))) {
    return error(404, `package not found: ${owner}/${name}`);
  }

  const { searchParams } = new URL(request.url);
  const limit = clampReviewsLimit(searchParams.get("limit") ?? undefined);
  const offset = clampReviewsOffset(searchParams.get("offset") ?? undefined);
  const sort = normalizeReviewSort(searchParams.get("sort") ?? undefined);

  const page = await getReviewsPage(owner, name, { limit, offset, sort });
  return json({
    items: page.items,
    average: page.average ?? null,
    count: page.count,
    limit,
    offset,
    sort,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "reviews require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester || !hasScope(requester, "review")) {
    return error(401, "sign in to leave a review");
  }

  const limited = rateLimit(`review:${requester.id}`, PUT_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  if (!(await resolvePackage(owner, name))) {
    return error(404, `package not found: ${owner}/${name}`);
  }

  const body = await request.json().catch(() => null);
  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid body", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  const result = await upsertReview(requester.id, owner, name, parsed.data);
  if (!result.ok) {
    return error(result.status, result.message);
  }

  return json({ review: result.review, average: result.average ?? null, count: result.count });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "reviews require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester || !hasScope(requester, "review")) {
    return error(401, "sign in to manage your review");
  }

  const result = await deleteReview(requester.id, owner, name);
  if (!result.ok) {
    return error(result.status, result.message);
  }

  return withCors(new Response(null, { status: 204 }));
}

export async function OPTIONS() {
  return preflight();
}
