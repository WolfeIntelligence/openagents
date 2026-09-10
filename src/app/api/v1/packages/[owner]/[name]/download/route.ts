import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { hasPurchased } from "@/lib/purchases";
import { error, preflight, withCors } from "@/lib/api";
import { packageTarball } from "@/lib/tarball";
import { recordDownload } from "@/lib/stats";

export const runtime = "nodejs";

// GET /api/v1/packages/[owner]/[name]/download — tar.gz of the package files.
// Free packages stay open to anyone. Paid packages require the requester to be the
// package owner or to hold a `paid` purchase — otherwise this returns 402.
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

  const isFree = pkg.manifest.pricing.model === "free" || pkg.manifest.pricing.amountCents === 0;
  if (!isFree) {
    const session = await auth();
    const isOwner = Boolean(session?.user?.handle && session.user.handle === owner);
    const purchased =
      isOwner || (session?.user?.id ? await hasPurchased(session.user.id, owner, name) : false);
    if (!purchased) {
      return error(402, "purchase required to download this package");
    }
  }

  const buffer = await packageTarball(pkg, (path) => catalog.getFile(owner, name, path));

  // This endpoint is the single path every install takes — the site's download
  // button, `openagents add`, and direct API use all land here — so it is the one
  // honest place to count a download. Awaited so the write is not cut short when
  // the function is frozen after the response; it never throws (see recordDownload).
  await recordDownload(owner, name);
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
