import { notFoundJson, preflight } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/v1/packages/<owner> (no <name>) isn't a real endpoint — the only
// package routes are /api/v1/packages and /api/v1/packages/<owner>/<name>.
// Next's router resolves this to src/app/api/v1/[...rest]/route.ts already
// (no route matches this exact segment depth under packages/), but this file
// makes the JSON 404 explicit rather than relying on that fallthrough, per
// docs/AUDIT-2026-09.md B14.
export const GET = notFoundJson;
export const POST = notFoundJson;
export const PUT = notFoundJson;
export const PATCH = notFoundJson;
export const DELETE = notFoundJson;

export async function OPTIONS() {
  return preflight();
}
