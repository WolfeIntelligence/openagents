import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { error, preflight, withCors } from "@/lib/api";
import { packageTarball } from "@/lib/tarball";

export const runtime = "nodejs";

// GET /api/v1/packages/[owner]/[name]/download — tar.gz of the package files.
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

  const buffer = await packageTarball(pkg, (path) => catalog.getFile(owner, name, path));
  const filename = `${owner}-${name}-${pkg.manifest.version}.tgz`;

  return withCors(
    new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    })
  );
}

export async function OPTIONS() {
  return preflight();
}
