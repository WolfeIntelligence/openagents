import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { RATE_LIMITS, withRateLimit } from "@/lib/ratelimit";
import { publishPackage, PublishError } from "@/lib/publish";
import { fetchGitHubPackageFiles, GitHubImportError } from "@/lib/github-import";

export const runtime = "nodejs";

const bodySchema = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1).optional(),
  subdir: z.string().optional(),
  changelog: z.string().optional(),
});

export async function POST(req: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "database not configured");
  }

  const requester = await getRequester(req);
  if (!requester) {
    return error(401, "unauthorized");
  }
  if (!hasScope(requester, "publish")) {
    return error(403, "insufficient scope");
  }
  if (!requester.handle) {
    return error(401, "unauthorized");
  }

  // Keyed by user, not IP — the same CLI/browser client legitimately imports from
  // different networks, but there's no reason one account needs more than 10 imports/min.
  const limited = await withRateLimit(req, "publish-import", {
    ...RATE_LIMITS.publishImport,
    key: `publish-import:${requester.id}`,
  });
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid body", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  try {
    const files = await fetchGitHubPackageFiles(
      parsed.data.repo,
      parsed.data.ref,
      parsed.data.subdir
    );
    const result = await publishPackage({
      userHandle: requester.handle,
      files,
      changelog: parsed.data.changelog,
    });
    return json(result, { status: 201 });
  } catch (err) {
    if (err instanceof GitHubImportError) {
      return json({ error: err.message, issues: err.errors }, { status: err.status });
    }
    if (err instanceof PublishError) {
      return json({ error: err.message, issues: err.errors }, { status: err.status });
    }
    return error(500, "publish failed");
  }
}

export async function OPTIONS() {
  return preflight();
}
