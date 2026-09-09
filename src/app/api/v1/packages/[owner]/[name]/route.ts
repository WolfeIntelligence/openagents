import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { json, error, preflight } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/v1/packages/[owner]/[name]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;
  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);
  if (!pkg) {
    return error(404, `package not found: ${owner}/${name}`);
  }
  return json(pkg);
}

export async function OPTIONS() {
  return preflight();
}
