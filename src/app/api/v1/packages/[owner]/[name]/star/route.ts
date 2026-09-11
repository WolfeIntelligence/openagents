import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { getStatsFor, isStarred, toggleStar } from "@/lib/stats";
import { clientIp, RATE_LIMITS, withRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// GET  /api/v1/packages/[owner]/[name]/star — current count, and whether the
//      signed-in user (if any) has starred it.
// POST /api/v1/packages/[owner]/[name]/star — toggle the signed-in user's star.
//
// One star per user per package, enforced by the primary key on `stars`, so the
// count is always the number of distinct people who pressed the button. There is
// no way to set it to an arbitrary value.
//
// 30 requests/min on the mutating endpoint only — GET is read-only and cheap
// enough (see below) not to need its own budget. Keyed by user id when signed
// in (the common case, since starring requires it a few lines down anyway),
// else by IP for the anonymous request that's about to get a 401.

async function resolve(owner: string, name: string) {
  const catalog = await getCatalog();
  return catalog.get(owner, name);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  // B14: this existence check goes through `catalog.get`, which loads more
  // than an existence check strictly needs (the readme, the manifest). There
  // is no cheaper option on the `Catalog` interface, though — `list({ owner })`
  // would have to fetch every package for this owner from the DB *and* scan
  // the entire seed catalog (list's DB path always merges against a full seed
  // scan, see `CATALOG_ALL_LIMIT` in catalog/index.ts) just to find one match
  // by name in memory, which is strictly more work than a single indexed
  // `get`. So: keep `get`, but at least stop paying for it serially — it
  // doesn't depend on the session, so run them together.
  const [pkg, session] = await Promise.all([resolve(owner, name), auth()]);
  if (!pkg) {
    return error(404, `package not found: ${owner}/${name}`);
  }

  const [stats, starred] = await Promise.all([
    getStatsFor(owner, name),
    session?.user?.id ? isStarred(session.user.id, owner, name) : Promise.resolve(false),
  ]);

  return json({ stars: stats.stars, starred });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "stars require a database; none is configured on this deployment");
  }

  // Resolved before rate limiting so the key can reflect the signed-in user
  // rather than always falling back to IP.
  const requester = await getRequester(request);
  const key = requester ? `star:user:${requester.id}` : `star:ip:${clientIp(request)}`;
  const limited = await withRateLimit(request, "star", { ...RATE_LIMITS.star, key });
  if (limited) return limited;

  if (!(await resolve(owner, name))) {
    return error(404, `package not found: ${owner}/${name}`);
  }

  if (!requester) {
    return error(401, "sign in to star a package");
  }
  if (!hasScope(requester, "star")) {
    return error(403, "insufficient scope");
  }

  const result = await toggleStar(requester.id, owner, name);
  if (!result) {
    return error(503, "stars are unavailable right now");
  }

  return json(result);
}

export async function OPTIONS() {
  return preflight();
}
