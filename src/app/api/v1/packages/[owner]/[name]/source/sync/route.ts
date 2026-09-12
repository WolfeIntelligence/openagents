import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { fetchGitHubPackageFiles, GitHubImportError } from "@/lib/github-import";
import { publishPackage, PublishError } from "@/lib/publish";
import { getSourceByPackage, recordSyncResult, repoUrl } from "@/lib/sources";
import { isPackageOwner } from "@/lib/access";

export const runtime = "nodejs";

// A manual sync does a network fetch + tarball extraction + full publish, same as
// publish/import — same (tighter) budget as that route, keyed by user.
const SYNC_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

// POST /api/v1/packages/[owner]/[name]/source/sync — owner or admin. Imports right
// now from `ref ?? the repo's default branch` and republishes if the manifest
// version moved forward (publishPackage itself enforces that; see its own
// "version must be greater than the current" check).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "GitHub sync requires a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");

  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);
  if (!pkg) return error(404, `package not found: ${owner}/${name}`);
  if (pkg.source === "seed") {
    return error(400, "seed packages can't be synced from GitHub here");
  }

  const admin = await isAdmin(requester);
  const isOwner = await isPackageOwner(requester, pkg);
  if (!isOwner && !admin) {
    return error(403, "only the package owner or an admin can do this");
  }

  const row = await getSourceByPackage(owner, name);
  if (!row) return error(404, "no GitHub source linked to this package");

  const limited = rateLimit(`source-sync:${requester.id}`, SYNC_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  try {
    const files = await fetchGitHubPackageFiles(repoUrl(row.repo), row.ref ?? undefined, row.subdir ?? undefined);
    const result = await publishPackage({ userHandle: pkg.owner, files });
    const message = `published ${result.version}`;
    await recordSyncResult(row.id, message);
    return json({ result: message });
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync failed";
    await recordSyncResult(row.id, `error: ${message}`);
    if (err instanceof GitHubImportError) return json({ error: err.message, issues: err.errors }, { status: err.status });
    if (err instanceof PublishError) return json({ error: err.message, issues: err.errors }, { status: err.status });
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(500, "sync failed");
  }
}

export async function OPTIONS() {
  return preflight();
}
