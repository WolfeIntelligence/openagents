import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { error, json, preflight } from "@/lib/api";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// GET /api/v1/search?q=&limit= — quick lookahead search. `q` is required
// (unlike /api/v1/packages, where it's just one more filter); see
// docs/AUDIT-2026-09.md B9d for the contract this route previously violated.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return error(400, "q is required");
  }

  const rawLimit = request.nextUrl.searchParams.get("limit");
  const parsed = rawLimit !== null ? Number(rawLimit) : NaN;
  const limit = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const catalog = await getCatalog();
  const { items, total, correctedQuery } = await catalog.list({ q, limit });
  return json(correctedQuery ? { items, total, correctedQuery } : { items, total });
}

export async function OPTIONS() {
  return preflight();
}
