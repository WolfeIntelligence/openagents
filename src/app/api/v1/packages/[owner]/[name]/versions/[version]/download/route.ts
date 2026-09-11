import { NextRequest } from "next/server";
import { getFileAtVersion, getPackageVersion } from "@/lib/catalog/versions";
import { auth } from "@/lib/auth";
import { resolveAccess, type Access } from "@/lib/access";
import { error, preflight, withCors } from "@/lib/api";
import { etagMatches, packageTarballWithDigest, tarballHeaders } from "@/lib/tarball";
import { recordDownload } from "@/lib/stats";
import { recordDownloadEvent } from "@/lib/analytics";
import { clientIp, RATE_LIMITS, withRateLimit } from "@/lib/ratelimit";
import { RUNTIME_IDS, type Package } from "@/lib/types";

export const runtime = "nodejs";

function invalidRuntimeParam(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("runtime");
  if (value && !(RUNTIME_IDS as readonly string[]).includes(value)) {
    return error(400, `invalid runtime: ${value}`);
  }
  return null;
}

type LoadedAccess = { found: true; pkg: Package; access: Access } | { found: false };

/** Loads the pinned version and resolves access against it. `found: false`
 *  means the caller should respond 404 — the package doesn't exist, or it
 *  does but never published this version. */
async function loadAccess(owner: string, name: string, version: string): Promise<LoadedAccess> {
  const pkg = await getPackageVersion(owner, name, version);
  if (!pkg) return { found: false };
  const session = await auth();
  const access = await resolveAccess(pkg, session);
  return { found: true, pkg, access };
}

/** Same install-recording rule as the "latest" download route: skip owners,
 *  only bump the public counter on this client's first download of the
 *  package today. Never called for HEAD or a 304. */
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

function notModifiedResponse(sha256: string, isFree: boolean): Response {
  return withCors(
    new Response(null, {
      status: 304,
      headers: {
        ETag: `"${sha256}"`,
        "Cache-Control": isFree ? "public, max-age=31536000, immutable" : "private, no-store",
      },
    })
  );
}

// GET /api/v1/packages/[owner]/[name]/versions/[version]/download — tarball
// pinned to one immutable published version (S4/G-V1), so `openagents add
// owner/name@1.2.0` always gets exactly those bytes. Same 402 paywall as the
// "latest" download route; honours `If-None-Match` with 304 since a pinned
// version's tarball — unlike "latest" — never changes underneath its ETag.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string; version: string }> }
) {
  const runtimeError = invalidRuntimeParam(request);
  if (runtimeError) return runtimeError;

  // Same key prefix ("download") as the "latest" route above — intentionally
  // shares one budget per IP across both, since a pinned-version download is
  // just another view of the same download.
  const limited = await withRateLimit(request, "download", {
    ...RATE_LIMITS.download,
    message: "too many download requests, slow down",
  });
  if (limited) return limited;

  const { owner, name, version } = await params;
  const loaded = await loadAccess(owner, name, version);
  if (!loaded.found) return error(404, `version not found: ${owner}/${name}@${version}`);
  // Pending packages are visible only to their owner until an admin approves them.
  if (loaded.pkg.status === "pending" && !loaded.access.isOwner) {
    return error(404, `package not found: ${owner}/${name}`);
  }
  const { pkg, access } = loaded;

  if (!access.canDownload) {
    return error(402, "purchase required to download this package");
  }

  const { buffer, sha256 } = await packageTarballWithDigest(pkg, (path) =>
    getFileAtVersion(owner, name, version, path)
  );

  if (etagMatches(request.headers.get("if-none-match"), sha256)) {
    return notModifiedResponse(sha256, access.isFree);
  }

  await recordInstall(request, owner, name, version, access);

  return withCors(
    new Response(new Uint8Array(buffer), {
      status: 200,
      headers: tarballHeaders({
        owner,
        name,
        version,
        sha256,
        contentLength: buffer.length,
        cache: access.isFree ? "immutable" : "private",
      }),
    })
  );
}

// HEAD — same headers, same paywall, never counts an install. No 304 handling:
// a HEAD has no body to save by short-circuiting, and the CLI's own integrity
// check reads `X-Checksum-Sha256`/ETag off this response either way.
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string; version: string }> }
) {
  const runtimeError = invalidRuntimeParam(request);
  if (runtimeError) return withCors(new Response(null, { status: 400 }));

  const { owner, name, version } = await params;
  const loaded = await loadAccess(owner, name, version);
  if (!loaded.found) return withCors(new Response(null, { status: 404 }));
  if (loaded.pkg.status === "pending" && !loaded.access.isOwner) {
    return withCors(new Response(null, { status: 404 }));
  }
  const { pkg, access } = loaded;

  if (!access.canDownload) {
    return withCors(new Response(null, { status: 402 }));
  }

  const { buffer, sha256 } = await packageTarballWithDigest(pkg, (path) =>
    getFileAtVersion(owner, name, version, path)
  );

  return withCors(
    new Response(null, {
      status: 200,
      headers: tarballHeaders({
        owner,
        name,
        version,
        sha256,
        contentLength: buffer.length,
        cache: access.isFree ? "immutable" : "private",
      }),
    })
  );
}

export async function OPTIONS() {
  return preflight();
}
