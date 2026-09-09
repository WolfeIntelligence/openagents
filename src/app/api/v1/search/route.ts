import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { json, preflight } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/v1/search?q= — top 10 matches.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  const catalog = await getCatalog();
  const { items } = await catalog.list({ q, limit: 10 });
  return json({ items });
}

export async function OPTIONS() {
  return preflight();
}
