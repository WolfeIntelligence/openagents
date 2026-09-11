import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { resolveAccess, type Access } from "@/lib/access";
import { error, preflight, withCors } from "@/lib/api";
import { packageTarballWithDigest, tarballHeaders } from "@/lib/tarball";
import { recordDownload } from "@/lib/stats";
import { recordDownloadEvent } from "@/lib/analytics";
import { clientIp, RATE_LIMITS, withRateLimit } from "@/lib/ratelimit";
import { RUNTIME_IDS, type Package } from "@/lib/types";

export const runtime = "nodejs";

/**
 * `?runtime=<id>` is accepted (and validated) and, since G-A3/analytics.ts,
 * recorded on the download event so sellers can see installs by runtime.
 */
function invalidRuntimeParam(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("runtime");
  if (value && !(RUNTIME_IDS as readonly string[]).includes(value)) {
    return error(400, `invalid runtime: ${value}`);
  }
  return null;
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

/**
 * Records an install for analytics (G-A1) and only bumps the public counter
 * when this is the client's first download of the package today (B10) — see
 * analytics.ts's `recordDownloadEvent`. Owners checking their own package
 * never count, and this is never called for HEAD (a probe, not an install).
 */
async function recordInstall(
  request: NextRequest,
  owner: string,
  name: string,
  version: string,
  access: Access
): Promise<void> {
  if (access.isOwner) return;
  const isNewToday = await recordDownloadEvent({
    owner,
    name,
    version,
    runtime: request.nextUrl.searchParams.get("runtime"),
    ip: clientIp(request),
  });
  if (isNewToday) await recordDownload(owner, name);
}

// GET /api/v1/packages/[owner]/[name]/download — tar.gz of the package's latest
// version. Free packages stay open to anyone. Paid packages require the requester
// to be the package owner or to hold a `paid` purchase — otherwise this returns 402.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const runtimeError = invalidRuntimeParam(request);
  if (runtimeError) return runtimeError;

  const limited = await withRateLimit(request, "download", {
    ...RATE_LIMITS.download,
    message: "too many download requests, slow down",
  });
  if (limited) return limited;

  const { owner, name } = await params;
  const loaded = await loadAccess(owner, name);
  if (!loaded.found) return error(404, `package not found: ${owner}/${name}`);
  // Pending packages are visible only to their owner until an admin approves them.
  if (loaded.pkg.status === "pending" && !loaded.access.isOwner) {
    return error(404, `package not found: ${owner}/${name}`);
  }
  const { pkg, catalog, access } = loaded;

  if (!access.canDownload) {
    return error(402, "purchase required to download this package");
  }

  const { buffer, sha256 } = await packageTarballWithDigest(pkg, (path) => catalog.getFile(owner, name, path));

  // This endpoint is the single path every install takes — the site's download
  // button, `openagents add`, and direct API use all land here — so it is the one
  // honest place to record an install. Awaited so the write is not cut short
  // when the function is frozen after the response; it never throws (see
  // recordDownloadEvent/recordDownload).
  await recordInstall(request, owner, name, pkg.manifest.version, access);

  return withCors(
    new Response(new Uint8Array(buffer), {
      status: 200,
      headers: tarballHeaders({
        owner,
        name,
        version: pkg.manifest.version,
        sha256,
        contentLength: buffer.length,
        // "latest" can change out from under a cached copy as new versions are
        // published, so free tarballs here keep the old, short-lived TTL —
        // unlike the versioned route's `immutable` (G-V4).
        cache: access.isFree ? "short" : "private",
      }),
    })
  );
}

// HEAD /api/v1/packages/[owner]/[name]/download — same headers as GET (including
// a real Content-Length, ETag and X-Checksum-Sha256, so a HEAD probe can show
// size/availability/integrity), same 402 paywall, but never counts as a download
// (B10: this used to be indistinguishable from a GET as far as the counter was
// concerned). Not rate-limited, per the convention that probes/preflight aren't
// billed against the same budget as actual transfers.
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const runtimeError = invalidRuntimeParam(request);
  if (runtimeError) return withCors(new Response(null, { status: 400 }));

  const { owner, name } = await params;
  const loaded = await loadAccess(owner, name);
  if (!loaded.found) return withCors(new Response(null, { status: 404 }));
  if (loaded.pkg.status === "pending" && !loaded.access.isOwner) {
    return withCors(new Response(null, { status: 404 }));
  }
  const { pkg, catalog, access } = loaded;

  if (!access.canDownload) {
    return withCors(new Response(null, { status: 402 }));
  }

  // Building the tarball is the only way to know its real Content-Length and
  // sha256 up front; it's the same work GET does, just discarded instead of
  // streamed back, and — importantly — never passed to recordInstall.
  const { buffer, sha256 } = await packageTarballWithDigest(pkg, (path) => catalog.getFile(owner, name, path));

  return withCors(
    new Response(null, {
      status: 200,
      headers: tarballHeaders({
        owner,
        name,
        version: pkg.manifest.version,
        sha256,
        contentLength: buffer.length,
        cache: access.isFree ? "short" : "private",
      }),
    })
  );
}

export async function OPTIONS() {
  return preflight();
}
