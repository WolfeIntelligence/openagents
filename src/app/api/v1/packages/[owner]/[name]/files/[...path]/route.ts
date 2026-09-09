import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { error, preflight, withCors } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/v1/packages/[owner]/[name]/files/[...path] — raw file text.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string; path: string[] }> }
) {
  const { owner, name, path } = await params;
  const filePath = path.join("/");
  const catalog = await getCatalog();
  const file = await catalog.getFile(owner, name, filePath);
  if (!file || file.content === undefined) {
    return error(404, `file not found: ${filePath}`);
  }
  return withCors(
    new Response(file.content, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

export async function OPTIONS() {
  return preflight();
}
