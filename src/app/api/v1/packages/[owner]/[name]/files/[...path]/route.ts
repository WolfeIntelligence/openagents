import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { getFileAtVersion, getPackageVersion } from "@/lib/catalog/versions";
import { auth } from "@/lib/auth";
import { resolveAccess } from "@/lib/access";
import { error, json, preflight, withCors } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import type { Package, PackageFile } from "@/lib/types";

export const runtime = "nodejs";

// 120 requests/min/IP — this route serves individual files (README images,
// syntax-highlighted source, etc.) so it legitimately sees more traffic per
// package view than the download route.
const RATE_LIMIT = { limit: 120, windowMs: 60_000 };

/** Content-Type by extension (B14): every raw file used to be served as
 *  `text/plain` regardless of what it actually was. */
function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  const ext = dot === -1 ? "" : filePath.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "json":
      return "application/json";
    case "yaml":
    case "yml":
      return "application/yaml";
    case "md":
      return "text/markdown";
    default:
      return "text/plain";
  }
}

// GET /api/v1/packages/[owner]/[name]/files/[...path] — raw file text, either
// from the package's latest version (default) or a specific published version
// via `?version=` (S4/G-V1). Paid packages only serve `access.PREVIEW_PATHS`
// for free (B2); everything else requires the requester to be the owner or a
// paid purchaser.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string; path: string[] }> }
) {
  const limited = rateLimit(`files:${clientIp(request)}`, RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const { owner, name, path } = await params;
  const filePath = path.join("/");
  const version = request.nextUrl.searchParams.get("version");

  let pkg: Package | null;
  let file: PackageFile | null;
  if (version) {
    pkg = await getPackageVersion(owner, name, version);
    file = pkg ? await getFileAtVersion(owner, name, version, filePath) : null;
  } else {
    const catalog = await getCatalog();
    pkg = await catalog.get(owner, name);
    file = pkg ? await catalog.getFile(owner, name, filePath) : null;
  }

  // Checked before the file lookup's result so an unknown version reports
  // "version not found" rather than the less specific "file not found".
  if (!pkg) {
    return error(
      404,
      version ? `version not found: ${owner}/${name}@${version}` : `package not found: ${owner}/${name}`
    );
  }
  if (!file || file.content === undefined) {
    return error(404, `file not found: ${filePath}`);
  }

  const session = await auth();
  const access = await resolveAccess(pkg, session);
  if (!access.canReadFile(filePath)) {
    return error(402, "purchase required to read this file");
  }

  return withCors(
    new Response(file.content, {
      status: 200,
      headers: {
        "Content-Type": `${contentTypeFor(filePath)}; charset=utf-8`,
        "X-Content-Type-Options": "nosniff",
        // Free-package files are identical for everyone. A pinned version's
        // files never change once published, so that case is cacheable for a
        // year (G-V4); "latest" can change as new versions are published, so
        // it keeps the old short TTL. Paid-package files vary by requester
        // (200 vs 402) either way and must never be cached or shared.
        "Cache-Control": access.isFree
          ? version
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300"
          : "private, no-store",
      },
    })
  );
}

export async function OPTIONS() {
  return preflight();
}
