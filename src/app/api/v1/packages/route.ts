import { NextRequest } from "next/server";
import { getCatalog, parseCatalogQuery } from "@/lib/catalog";
import { json, preflight } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/v1/packages?q=&kind=&runtime=&price=&tag=&owner=&sort=&limit=&offset=
export async function GET(request: NextRequest) {
  const query = parseCatalogQuery(request.nextUrl.searchParams);
  const catalog = await getCatalog();
  const page = await catalog.list(query);
  return json(page);
}

export async function OPTIONS() {
  return preflight();
}
