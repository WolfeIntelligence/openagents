import { NextRequest } from "next/server";
import { getCatalog, parseCatalogQuery } from "@/lib/catalog";
import { json, preflight } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/v1/packages?q=&kind=&runtime=&price=&tag=&owner=&sort=&limit=&offset=&facets=
export async function GET(request: NextRequest) {
  const query = parseCatalogQuery(request.nextUrl.searchParams);
  const catalog = await getCatalog();
  const [page, facets] = await Promise.all([
    catalog.list(query),
    // `?facets=1` (G-S3) — optional on the Catalog interface, and only worth
    // computing when a caller actually asked for it.
    query.facets ? catalog.facets?.(query) : Promise.resolve(undefined),
  ]);
  return json(facets ? { ...page, facets } : page);
}

export async function OPTIONS() {
  return preflight();
}
