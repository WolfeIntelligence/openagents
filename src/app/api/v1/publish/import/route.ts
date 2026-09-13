import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { RATE_LIMITS, withRateLimit } from "@/lib/ratelimit";
import { publishPackage, PublishError } from "@/lib/publish";
import { fetchGitHubPackageFiles, GitHubImportError, resolveImportManifest } from "@/lib/github-import";
import { MACHINE_PRINCIPAL_LABEL } from "@/lib/machine";

export const runtime = "nodejs";

const bodySchema = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1).optional(),
  subdir: z.string().optional(),
  changelog: z.string().optional(),
  // A draft openagent.yaml (raw YAML text, same shape a repo's own manifest would
  // hold) used only when the target repo/ref/subdir has no openagent.yaml of its
  // own — see resolveImportManifest in @/lib/github-import.
  manifest: z.string().min(1).optional(),
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
    const fetched = await fetchGitHubPackageFiles(parsed.data.repo, parsed.data.ref, parsed.data.subdir, {
      // The repo might have no openagent.yaml at all — that's fine as long as
      // parsed.data.manifest proposes one; resolveImportManifest below is what
      // actually enforces "one or the other must be present".
      requireManifest: false,
      // Needed so the stored version's origin.commit is the exact commit this
      // import's files came from, not just whatever ref was requested.
      resolveCommit: true,
    });
    // resolveCommit: true guarantees `commit` is set (or fetchGitHubPackageFiles
    // already threw) — this is just satisfying the type, not a real fallback path.
    if (!fetched.commit) {
      return error(500, "failed to resolve a commit sha for this import");
    }

    // Only actually used by resolveImportManifest when parsed.data.manifest is what
    // wins (the repo has no openagent.yaml of its own) — see its doc comment. Records
    // who ran this import as the published version's attested_by.name, same field
    // PR #13 added; requester.handle is "wolfe-factory" (MACHINE_HANDLE) for the
    // machine principal, matching the example in docs/package-format.md#provenance.
    const { files, manifestSource } = resolveImportManifest(
      { ...fetched, commit: fetched.commit },
      parsed.data.manifest,
      { name: requester.handle }
    );

    const result = await publishPackage({
      userHandle: requester.handle,
      files,
      changelog: parsed.data.changelog,
      asMachine: requester.via === "machine",
    });
    // Audit trail for the machine principal: identifies it by the fixed
    // label below, never by requester.id and never anything derived from
    // OPENAGENTS_MACHINE_SECRET itself.
    if (requester.via === "machine") {
      console.log(`[publish] ${MACHINE_PRINCIPAL_LABEL} imported ${result.id}@${result.version} from ${parsed.data.repo}`);
    }
    // manifestSource tells the caller (e.g. the scout agent) whether its
    // proposed manifest was actually used, or the repo turned out to already
    // have its own — which always wins when present.
    return json({ ...result, manifestSource }, { status: 201 });
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
