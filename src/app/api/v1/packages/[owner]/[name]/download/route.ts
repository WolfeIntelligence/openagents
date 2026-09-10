import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { resolveAccess, type Access } from "@/lib/access";
import { error, json, preflight, withCors } from "@/lib/api";
import { packageTarball } from "@/lib/tarball";
import { recordDownload } from "@/lib/stats";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { RUNTIME_IDS, type Package } from "@/lib/types";

export const runtime = "nodejs";

// 60 requests/min/IP — generous for real installs, tight enough to blunt the
// unrated-limited counter inflation described in B10.
const GET_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

/**
 * `?runtime=<id>` is accepted (and validated) but not yet stored anywhere —
 * it lets a future CLI attribute installs to a runtime (see G-A3) without a
 * breaking API change later. Validating now means a typo'd value fails loudly
 * today instead of silently doing nothing once it *is* wired up.
 */
function invalidRuntimeParam(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("runtime");
  if (value && !(RUNTIME_IDS as readonly string[]).includes(value)) {
    return error(400, `invalid runtime: ${value}`);
  }
  return null;
}

function tarballHeaders(pkg: Package, access: Access, contentLength: number): HeadersInit {
  const filename = `${pkg.owner}-${pkg.name}-${pkg.manifest.version}.tgz`;
  return {
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(contentLength),
    // Free tarballs are identical for everyone and cheap to recompute, so a
    // shared cache is fine; paid ones vary by who's asking (402 vs 200) and
    // must never be cached or shared across requesters.
    "Cache-Control": access.isFree ? "public, max-age=300" : "private, no-store",
  };
}

type LoadedAccess =
  | { found: true; pkg: Package; catalog: Awaited<ReturnType<typeof getCatalog>>; access: Access }
  | { found: false };

/** Loads the package and resolves access. `found: false` means the caller
 *  should respond 404 — kept as a plain flag rather than an inline response so
 *  GET and HEAD can each shape their own 404 (JSON body vs. an empty body). */
async function loadAccess(owner: string, name: string): Promise<LoadedAccess> {
  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);
  if (!pkg) return { found: false };
  const session = await auth();
  const access = await resolveAccess(pkg, session);
  return { found: true, pkg, catalog, access };
}

// GET /api/v1/packages/[owner]/[name]/download — tar.gz of the package files.
// Free packages stay open to anyone. Paid packages require the requester to be the
// package owner or to hold a `paid` purchase — otherwise this returns 402.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const runtimeError = invalidRuntimeParam(request);
  if (runtimeError) return runtimeError;

  const limited = rateLimit(`download:${clientIp(request)}`, GET_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many download requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const { owner, name } = await params;
  const loaded = await loadAccess(owner, name);
  if (!loaded.found) return error(404, `package not found: ${owner}/${name}`);
  const { pkg, catalog, access } = loaded;

  if (!access.canDownload) {
    return error(402, "purchase required to download this package");
  }

  const buffer = await packageTarball(pkg, (path) => catalog.getFile(owner, name, path));

  // This endpoint is the single path every install takes — the site's download
  // button, `openagents add`, and direct API use all land here — so it is the one
  // honest place to count a download. Skip the owner's own downloads (B10): those
  // are the seller checking their own package, not an install. Awaited so the
  // write is not cut short when the function is frozen after the response; it
  // never throws (see recordDownload).
  if (!access.isOwner) {
    await recordDownload(owner, name);
  }

  return withCors(
    new Response(new Uint8Array(buffer), {
      status: 200,
      headers: tarballHeaders(pkg, access, buffer.length),
    })
  );
}

// HEAD /api/v1/packages/[owner]/[name]/download — same headers as GET (including
// a real Content-Length, so a HEAD probe can show size/availability), same 402
// paywall, but never counts as a download (B10: this used to be indistinguishable
// from a GET as far as the counter was concerned). Not rate-limited, per the
// convention that probes/preflight aren't billed against the same budget as
// actual transfers.
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const runtimeError = invalidRuntimeParam(request);
  if (runtimeError) return withCors(new Response(null, { status: 400 }));

  const { owner, name } = await params;
  const loaded = await loadAccess(owner, name);
  if (!loaded.found) return withCors(new Response(null, { status: 404 }));
  const { pkg, catalog, access } = loaded;

  if (!access.canDownload) {
    return withCors(new Response(null, { status: 402 }));
  }

  // Building the tarball is the only way to know its real Content-Length up
  // front; it's the same work GET does, just discarded instead of streamed
  // back, and — importantly — never passed to `recordDownload`.
  const buffer = await packageTarball(pkg, (path) => catalog.getFile(owner, name, path));

  return withCors(
    new Response(null, {
      status: 200,
      headers: tarballHeaders(pkg, access, buffer.length),
    })
  );
}

export async function OPTIONS() {
  return preflight();
}
