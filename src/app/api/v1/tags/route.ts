import { getCatalog } from "@/lib/catalog";
import { json, preflight } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/v1/tags — every tag across seed + DB packages with its package
// count, most-used first (G-C1). Backs the /tags index page and can seed a
// tag-autocomplete in the publish form.
export async function GET() {
  const catalog = await getCatalog();
  const items = await catalog.tags();
  return json({ items });
}

export async function OPTIONS() {
  return preflight();
}
