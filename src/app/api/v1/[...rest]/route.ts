import { notFoundJson, preflight } from "@/lib/api";

export const runtime = "nodejs";

// Catch-all for any /api/v1/* path that doesn't match a more specific route
// (typos, removed endpoints, a path with the wrong number of segments — e.g.
// /api/v1/packages/<owner> with no <name>). Without this, Next falls through
// to the HTML 404 page for these, breaking the "every non-2xx is {error}"
// contract every other /api/v1/* route follows. See docs/AUDIT-2026-09.md B14.
export const GET = notFoundJson;
export const POST = notFoundJson;
export const PUT = notFoundJson;
export const PATCH = notFoundJson;
export const DELETE = notFoundJson;

export async function OPTIONS() {
  return preflight();
}
