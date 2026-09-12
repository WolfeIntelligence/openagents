import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { error, json, preflight } from "@/lib/api";
import { buildVersionDiff } from "@/lib/packageDiff";

export const runtime = "nodejs";

// GET /api/v1/packages/[owner]/[name]/versions/[version]/diff?against=<version>
// — per-file diff between `against` (from) and `version` (to) (Z3). Same
// per-version paywall as the pinned-version download route: a paid
// package's diff requires ownership/purchase, reported as 402 rather than a
// partial per-file lock (see `buildVersionDiff`).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string; version: string }> }
) {
  const { owner, name, version } = await params;
  const against = request.nextUrl.searchParams.get("against");
  if (!against) return error(400, "missing required query param: against");

  const session = await auth();
  const outcome = await buildVersionDiff(owner, name, version, against, session);
  if (!outcome.ok) return error(outcome.status, outcome.message);

  // 5-minute cache (contract) — a published version's content never changes,
  // so the only thing that can invalidate this is a new version publishing,
  // which is exactly the kind of staleness a short cache is fine with.
  return json(outcome.result, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
}

export async function OPTIONS() {
  return preflight();
}
