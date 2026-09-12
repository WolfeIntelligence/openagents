import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { error, json, preflight } from "@/lib/api";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
// `?suggest=1` (Z7 search-as-you-type) defaults to a tighter page than the
// full search endpoint — a dropdown, not a results page.
const DEFAULT_SUGGEST_LIMIT = 6;

// GET /api/v1/search?q=&limit= — quick lookahead search. `q` is required
// (unlike /api/v1/packages, where it's just one more filter); see
// docs/AUDIT-2026-09.md B9d for the contract this route previously violated.
//
// `?suggest=1` (Z7) returns the same query shaped down to the slim fields a
// combobox needs (`id`, `owner`, `name`, `title`, `kind`, `pricing.model`)
// and is cacheable for a minute — unlike the default response, it carries no
// per-viewer state, so every client typing the same query can share a cache
// entry.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return error(400, "q is required");
  }

  const suggest = request.nextUrl.searchParams.get("suggest") === "1";
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const parsed = rawLimit !== null ? Number(rawLimit) : NaN;
  const limit = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), 1), MAX_LIMIT)
    : suggest
      ? DEFAULT_SUGGEST_LIMIT
      : DEFAULT_LIMIT;

  const catalog = await getCatalog();
  const { items, total, correctedQuery } = await catalog.list({ q, limit });

  if (suggest) {
    const slimItems = items.map((item) => ({
      id: item.id,
      owner: item.owner,
      name: item.name,
      title: item.title,
      kind: item.kind,
      pricing: { model: item.pricing.model },
    }));
    return json(
      correctedQuery ? { items: slimItems, total, correctedQuery } : { items: slimItems, total },
      { headers: { "Cache-Control": "public, max-age=60" } }
    );
  }

  return json(correctedQuery ? { items, total, correctedQuery } : { items, total });
}

export async function OPTIONS() {
  return preflight();
}
