import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { json, error, preflight } from "@/lib/api";
import { activeAdvisories } from "@/lib/advisories";
import { getSourceByPackage } from "@/lib/sources";

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

  // Z2: active security advisories for the version currently shown, and
  // whether this package is auto-published from a linked GitHub repo (a
  // "verified source" — the sync only ever writes what's actually in the
  // repo at the synced ref, unlike a hand-uploaded tarball).
  const [advisories, source] = await Promise.all([
    activeAdvisories(owner, name),
    getSourceByPackage(owner, name),
  ]);
  const verifiedSource =
    source && source.lastResult?.startsWith("published")
      ? { repo: source.repo, ref: source.ref, lastSyncedAt: source.lastSyncedAt }
      : null;

  // S4/G-V1: lets a client show "what's current" without re-deriving it from
  // manifest.version itself; kept alongside every existing field, not instead
  // of them.
  return json({ ...pkg, latestVersion: pkg.manifest.version, advisories, verifiedSource });
}

export async function OPTIONS() {
  return preflight();
}
