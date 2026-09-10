import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { getStatsFor, isStarred, toggleStar } from "@/lib/stats";

export const runtime = "nodejs";

// GET  /api/v1/packages/[owner]/[name]/star — current count, and whether the
//      signed-in user (if any) has starred it.
// POST /api/v1/packages/[owner]/[name]/star — toggle the signed-in user's star.
//
// One star per user per package, enforced by the primary key on `stars`, so the
// count is always the number of distinct people who pressed the button. There is
// no way to set it to an arbitrary value.

async function resolve(owner: string, name: string) {
  const catalog = await getCatalog();
  return catalog.get(owner, name);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;
  if (!(await resolve(owner, name))) {
    return error(404, `package not found: ${owner}/${name}`);
  }

  const session = await auth();
  const stats = await getStatsFor(owner, name);
  const starred = session?.user?.id ? await isStarred(session.user.id, owner, name) : false;

  return json({ stars: stats.stars, starred });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "stars require a database; none is configured on this deployment");
  }
  if (!(await resolve(owner, name))) {
    return error(404, `package not found: ${owner}/${name}`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return error(401, "sign in to star a package");
  }

  const result = await toggleStar(session.user.id, owner, name);
  if (!result) {
    return error(503, "stars are unavailable right now");
  }

  return json(result);
}

export async function OPTIONS() {
  return preflight();
}
