import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { json } from "@/lib/api";
import { fetchGitHubPackageFiles, GitHubImportError } from "@/lib/github-import";
import { publishPackage, PublishError } from "@/lib/publish";
import { ManifestError, parseManifest } from "@/lib/manifest";
import {
  classifyEvent,
  decideSync,
  deriveSecret,
  getSourceById,
  payloadRepoFullName,
  recordSyncResult,
  repoUrl,
  sameRepo,
  verifySignature,
  webhookKey,
} from "@/lib/sources";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

// POST /api/webhooks/github/[id] — GitHub calls this directly (no browser, no CORS
// preflight), so unlike the /api/v1/* routes it doesn't go through src/lib/api.ts's
// CORS wrapper for anything but the JSON envelope; there's no OPTIONS handler either.
//
// Every deterministic outcome below — an event we don't act on, a version that isn't
// newer, a manifest that fails to parse, a publish that fails validation — returns
// 200. GitHub retries any non-2xx delivery, and none of those would come out
// differently on a retry. Only genuine auth/shape problems (unknown link, bad
// signature, unparseable JSON, wrong repo) return a non-2xx status.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await getSourceById(id);
  if (!row) return json({ error: "unknown webhook" }, { status: 404 });

  const key = webhookKey();
  if (!key) return json({ error: "GitHub sync is not configured" }, { status: 503 });

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return json({ error: "payload too large" }, { status: 413 });
  }

  const secret = deriveSecret(row.id, key);
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifySignature(raw, signature, secret)) {
    return json({ error: "signature verification failed" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const fullName = payloadRepoFullName(payload);
  if (!fullName || !sameRepo(fullName, row.repo)) {
    return json({ error: `payload repository does not match the linked repo (${row.repo})` }, { status: 400 });
  }

  const eventName = request.headers.get("x-github-event") ?? "";
  const decision = classifyEvent(eventName, payload);

  if (decision.kind === "ping") return json({ ok: true });
  if (decision.kind === "ignored") return json({ ignored: true });

  try {
    const catalog = await getCatalog();
    const pkg = await catalog.get(row.owner, row.name);
    if (!pkg) throw new Error(`linked package not found: ${row.owner}/${row.name}`);

    const files = await fetchGitHubPackageFiles(repoUrl(row.repo), decision.ref, row.subdir ?? undefined);
    const manifestFile = files.find((f) => f.path === "openagent.yaml");
    if (!manifestFile) throw new Error("openagent.yaml missing from the imported files");
    const manifest = parseManifest(manifestFile.content);

    const syncDecision = decideSync(manifest.version, pkg.manifest.version);
    if (!syncDecision.publish) {
      await recordSyncResult(row.id, `skipped: ${syncDecision.message}`);
      return json({ skipped: syncDecision.message });
    }

    const result = await publishPackage({ userHandle: pkg.owner, files });
    await recordSyncResult(row.id, `published ${result.version}`);
    return json({ published: result.version });
  } catch (err) {
    const message =
      err instanceof ManifestError
        ? err.issues.join("; ")
        : err instanceof GitHubImportError || err instanceof PublishError
          ? err.message
          : err instanceof Error
            ? err.message
            : "sync failed";
    await recordSyncResult(row.id, `error: ${message}`);
    return json({ error: message });
  }
}
