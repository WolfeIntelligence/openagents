import { NextRequest } from "next/server";
import { z } from "zod";
import { getCatalog } from "@/lib/catalog";
import { getRequester, type Requester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight, withCors } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { absoluteUrl } from "@/lib/site";
import type { Package } from "@/lib/types";
import {
  formatRepo,
  getSourceByPackage,
  isSourceSyncConfigured,
  linkSource,
  parseRepoInput,
  secretStatus,
  SourceError,
  unlinkSource,
} from "@/lib/sources";

export const runtime = "nodejs";

// Owner or admin only, and shared by all three verbs here — cheap enough (one
// catalog lookup, no separate DB round trip) to redo per request rather than cache.
const RATE_LIMIT = { limit: 10, windowMs: 60_000 };

function webhookUrlFor(id: string): string {
  return absoluteUrl(`/api/webhooks/github/${id}`);
}

type AuthOk = { requester: Requester; pkg: Package };
type AuthResult = AuthOk | { errorResponse: Response };

/** Shared owner-or-admin gate: the package must exist, be DB-backed (a seed package
 *  has nothing to link — it lives in git already, under nobody's account here), and
 *  the caller must be its owner or an admin. */
async function authorize(request: NextRequest, owner: string, name: string): Promise<AuthResult> {
  const requester = await getRequester(request);
  if (!requester) return { errorResponse: error(401, "sign in required") };

  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);
  if (!pkg) return { errorResponse: error(404, `package not found: ${owner}/${name}`) };
  if (pkg.source === "seed") {
    return { errorResponse: error(400, "seed packages can't be linked to a GitHub repo") };
  }

  const admin = await isAdmin(requester);
  const isOwner = Boolean(requester.handle && requester.handle === pkg.owner);
  if (!isOwner && !admin) {
    return { errorResponse: error(403, "only the package owner or an admin can do this") };
  }

  return { requester, pkg };
}

const putBodySchema = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1).optional(),
  subdir: z.string().min(1).optional(),
});

// PUT /api/v1/packages/[owner]/[name]/source — link (or re-link) a GitHub repo.
//   { repo: "owner/repo" | "https://github.com/owner/repo", ref?, subdir? }
// Always mints a fresh id/secret, even for an existing link (see sources.ts).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "GitHub sync requires a database; none is configured on this deployment");
  }
  if (!isSourceSyncConfigured()) {
    return error(503, "GitHub sync is not configured");
  }

  const auth = await authorize(request, owner, name);
  if ("errorResponse" in auth) return auth.errorResponse;

  const limited = rateLimit(`source-link:${auth.requester.id}`, RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid body", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  try {
    const repo = parseRepoInput(parsed.data.repo);
    const { row, secret } = await linkSource({
      owner,
      name,
      userId: auth.requester.id,
      repo: formatRepo(repo),
      ref: parsed.data.ref,
      subdir: parsed.data.subdir,
    });

    return json(
      {
        id: row.id,
        repo: row.repo,
        ref: row.ref,
        subdir: row.subdir,
        webhookUrl: webhookUrlFor(row.id),
        secret,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof SourceError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

// GET /api/v1/packages/[owner]/[name]/source — owner or admin. 404 when not linked.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "GitHub sync requires a database; none is configured on this deployment");
  }

  const auth = await authorize(request, owner, name);
  if ("errorResponse" in auth) return auth.errorResponse;

  const row = await getSourceByPackage(owner, name);
  if (!row) return error(404, "no GitHub source linked to this package");

  const { secret } = secretStatus(row);

  return json({
    id: row.id,
    repo: row.repo,
    ref: row.ref,
    subdir: row.subdir,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastResult: row.lastResult,
    webhookUrl: webhookUrlFor(row.id),
    secret,
  });
}

// DELETE /api/v1/packages/[owner]/[name]/source — owner or admin. Always 204.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "GitHub sync requires a database; none is configured on this deployment");
  }

  const auth = await authorize(request, owner, name);
  if ("errorResponse" in auth) return auth.errorResponse;

  await unlinkSource(owner, name);
  return withCors(new Response(null, { status: 204 }));
}

export async function OPTIONS() {
  return preflight();
}
