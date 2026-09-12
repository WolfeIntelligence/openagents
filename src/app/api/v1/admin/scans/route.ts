import { NextRequest } from "next/server";
import { desc, eq, gte } from "drizzle-orm";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { packages, packageVersions } from "@/lib/db/schema";
import { error, json, preflight } from "@/lib/api";

export const runtime = "nodejs";

/** Default floor for "Flagged uploads" — the same threshold the admin page's
 *  section documents (score >= 40 is worth a human glance; >= 70 is already
 *  held for review automatically by publish.ts). */
const DEFAULT_MIN_SCORE = 40;
const MAX_RESULTS = 200;

// GET /api/v1/admin/scans?min=40 — admin-only.
// Recent package versions whose publish-time scan score is >= `min`, newest
// first, for the admin "Flagged uploads" list.
export async function GET(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "admin actions require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await isAdmin(requester))) return error(403, "admin access required");

  const minParam = new URL(request.url).searchParams.get("min");
  const min = minParam !== null ? Number(minParam) : DEFAULT_MIN_SCORE;
  if (!Number.isFinite(min) || min < 0 || min > 100) {
    return error(400, `"min" must be a number between 0 and 100`);
  }

  const db = getDb();
  if (!db) {
    return error(503, "admin actions require a database; none is configured on this deployment");
  }

  const rows = await db
    .select({
      version: packageVersions.version,
      riskScore: packageVersions.riskScore,
      scanFlags: packageVersions.scanFlags,
      publishedAt: packageVersions.publishedAt,
      owner: packages.owner,
      name: packages.name,
    })
    .from(packageVersions)
    .innerJoin(packages, eq(packageVersions.packageId, packages.id))
    .where(gte(packageVersions.riskScore, min))
    .orderBy(desc(packageVersions.publishedAt))
    .limit(MAX_RESULTS);

  return json({
    items: rows.map((r) => ({
      id: `${r.owner}/${r.name}`,
      owner: r.owner,
      name: r.name,
      version: r.version,
      riskScore: r.riskScore,
      scanFlags: r.scanFlags,
      publishedAt: r.publishedAt.toISOString(),
      url: `/p/${r.owner}/${r.name}`,
    })),
  });
}

export async function OPTIONS() {
  return preflight();
}
