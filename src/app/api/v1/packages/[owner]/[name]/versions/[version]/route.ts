import { NextRequest } from "next/server";
import { getPackageVersion } from "@/lib/catalog/versions";
import { error, json, preflight } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/v1/packages/[owner]/[name]/versions/[version] — same JSON shape as
// the package detail route, but the manifest/readme/files/version are pinned
// to one immutable published version instead of the package's latest (S4/G-V1).
// 404 when that version was never published (seed packages only ever know
// their current version — see getPackageVersion's doc comment).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string; version: string }> }
) {
  const { owner, name, version } = await params;
  const pkg = await getPackageVersion(owner, name, version);
  if (!pkg) {
    return error(404, `version not found: ${owner}/${name}@${version}`);
  }
  return json(pkg);
}

export async function OPTIONS() {
  return preflight();
}
