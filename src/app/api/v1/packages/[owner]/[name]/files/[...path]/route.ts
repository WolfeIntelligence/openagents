import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { resolveAccess } from "@/lib/access";
import { error, json, preflight, withCors } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";

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

// GET /api/v1/packages/[owner]/[name]/files/[...path] — raw file text.
// Paid packages only serve `access.PREVIEW_PATHS` for free (B2); everything else
// requires the requester to be the owner or a paid purchaser.
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
  const catalog = await getCatalog();
  const file = await catalog.getFile(owner, name, filePath);
  if (!file || file.content === undefined) {
    return error(404, `file not found: ${filePath}`);
  }

  // The file list is public in the package manifest either way (the Files tab
  // shows every path), so checking existence before the paywall doesn't leak
  // anything a purchase page wouldn't already show — keep the order simple:
  // 404 for unknown files, then 402 for gated ones.
  const pkg = await catalog.get(owner, name);
  if (!pkg) {
    return error(404, `package not found: ${owner}/${name}`);
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
        // Free-package files are identical for everyone; paid-package files
        // vary by requester (200 vs 402) and must never be cached or shared.
        "Cache-Control": access.isFree ? "public, max-age=300" : "private, no-store",
      },
    })
  );
}

export async function OPTIONS() {
  return preflight();
}
