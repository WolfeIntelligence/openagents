import { NextRequest } from "next/server";
import { listVersions } from "@/lib/catalog/versions";
import { error, json, preflight } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/v1/packages/[owner]/[name]/versions — newest-first version history
// (S4/G-V1). Every published package has at least one version (seed packages
// report their current manifest version; every DB package gets a version row
// at its first publish), so an empty result means the package itself doesn't
// exist rather than that it has no versions.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;
  const versions = await listVersions(owner, name);
  if (versions.length === 0) {
    return error(404, `package not found: ${owner}/${name}`);
  }
  return json({ versions });
}

export async function OPTIONS() {
  return preflight();
}
