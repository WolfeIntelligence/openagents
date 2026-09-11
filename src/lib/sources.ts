// GitHub auto-sync (Y7): links a DB-backed package to a GitHub repo so pushing a tag
// or publishing a release republishes it automatically, without the owner running the
// CLI or re-uploading. Three layers live here:
//   - pure helpers (repo parsing, secret derivation, signature verification, webhook
//     event classification, the version decision) — unit-tested directly, no DB/env.
//   - DB plumbing over `package_sources` (one row per linked package).
// The three routes (link/get/unlink, manual sync, and the webhook receiver) are thin
// wrappers around these.
//
// Safe to import with zero env vars: every DB-touching export checks getDb() first,
// and `isSourceSyncConfigured()` gates the feature on SOURCE_WEBHOOK_KEY/AUTH_SECRET
// being set at all.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packageSources } from "@/lib/db/schema";
import { isGreater, SemverError } from "@/lib/semver";

/** Thrown for any source-management failure; `status` is the HTTP status the route should return. */
export class SourceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SourceError";
    this.status = status;
  }
}

export type SourceRow = typeof packageSources.$inferSelect;

// ---------------------------------------------------------------------------
// Repo parsing — pure, no DB/env.
// ---------------------------------------------------------------------------

export interface ParsedRepo {
  owner: string;
  repo: string;
}

const OWNER_RE = /^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/;
const REPO_NAME_RE = /^[\w.-]{1,100}$/;

/**
 * Accepts `"owner/repo"` shorthand or a full `https://github.com/owner/repo[.git]`
 * URL and returns the normalized parts (original case preserved — GitHub repo names
 * are case-insensitive, so callers that need to compare two of these should use
 * `sameRepo`, not `===`). `ref`/`subdir` are separate PUT-body fields, so a URL
 * carrying more path (`/tree/...`) is rejected with a pointer to those fields rather
 * than silently ignored.
 */
export function parseRepoInput(input: string): ParsedRepo {
  const trimmed = input.trim();
  if (!trimmed) throw new SourceError(400, "repo is required");

  let owner: string;
  let repoRaw: string;
  let rest: string[] = [];

  const looksLikeUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) || /^(www\.)?github\.com\//i.test(trimmed);
  if (looksLikeUrl) {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      throw new SourceError(400, `not a valid URL: "${input}"`);
    }
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") {
      throw new SourceError(400, `only github.com repos are supported (got "${url.hostname}")`);
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new SourceError(400, `expected https://github.com/{owner}/{repo}, got "${input}"`);
    }
    [owner, repoRaw] = segments;
    rest = segments.slice(2);
  } else {
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length !== 2) {
      throw new SourceError(400, `repo must look like "owner/repo" or a github.com URL (got "${input}")`);
    }
    [owner, repoRaw] = parts;
  }

  if (rest.length > 0) {
    throw new SourceError(400, `pass ref/subdir as separate fields, not in the repo URL: "${input}"`);
  }

  const repo = repoRaw.replace(/\.git$/i, "");
  if (!OWNER_RE.test(owner) || !REPO_NAME_RE.test(repo)) {
    throw new SourceError(400, `not a valid github.com/{owner}/{repo}: "${input}"`);
  }

  return { owner, repo };
}

export function formatRepo(p: ParsedRepo): string {
  return `${p.owner}/${p.repo}`;
}

/** `"owner/repo"` -> the `github.com` URL `fetchGitHubPackageFiles` expects. */
export function repoUrl(repoFull: string): string {
  return `https://github.com/${repoFull}`;
}

/** True when two `"owner/repo"` strings name the same repo — GitHub repo names are
 *  case-insensitive, which matters when comparing a webhook payload's
 *  `repository.full_name` against what was stored at link time. */
export function sameRepo(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Secret derivation — pure given a key, no DB.
// ---------------------------------------------------------------------------

/** The env var every derived webhook secret is seeded from. A dedicated key is
 *  preferred so rotating `AUTH_SECRET` (which also re-signs every session) doesn't
 *  silently break every linked webhook; falling back to it means the feature still
 *  works on a fresh deployment with one fewer secret to configure. */
export function webhookKey(): string | undefined {
  return process.env.SOURCE_WEBHOOK_KEY ?? process.env.AUTH_SECRET;
}

export function isSourceSyncConfigured(): boolean {
  return Boolean(webhookKey());
}

/**
 * Deterministic per-link secret: `HMAC-SHA256(key, linkId)`, hex-encoded. Never
 * stored — recomputed whenever it's needed (link creation, redisplay on
 * `/settings/sources`, and webhook verification) — only its hash lives in the
 * database, purely to detect a key rotation later (see `secretStatus`).
 */
export function deriveSecret(linkId: string, key: string): string {
  return createHmac("sha256", key).update(linkId).digest("hex");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface SecretStatus {
  /** null when the key that seeded this link's secret has since changed — the
   *  secret GitHub was given at setup time can never be reproduced or re-verified,
   *  so there is nothing valid to show. */
  secret: string | null;
  /** Present only when `secret` is null; explains why (surfaced on /settings/sources). */
  reason?: string;
}

/** Recomputes `row`'s secret from the current key and checks it against the stored
 *  `secretHash` fingerprint. A mismatch means `SOURCE_WEBHOOK_KEY`/`AUTH_SECRET`
 *  changed since this link was created — GitHub's stored webhook secret is now
 *  unrecoverable and the link must be re-created (PUT again) to mint a fresh one. */
export function secretStatus(row: Pick<SourceRow, "id" | "secretHash">): SecretStatus {
  const key = webhookKey();
  if (!key) return { secret: null, reason: "GitHub sync is not configured" };
  const secret = deriveSecret(row.id, key);
  if (hashSecret(secret) !== row.secretHash) {
    return { secret: null, reason: "re-link required: the signing key changed since this was linked" };
  }
  return { secret };
}

// ---------------------------------------------------------------------------
// Webhook signature verification — pure, no DB.
// ---------------------------------------------------------------------------

const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/i;

/**
 * Verifies a GitHub `X-Hub-Signature-256: sha256=<hex>` header against `rawBody`
 * using `secret`. Constant-time comparison; false (never throws) for a missing,
 * malformed, or mismatched header.
 */
export function verifySignature(
  rawBody: Buffer | string,
  header: string | null | undefined,
  secret: string
): boolean {
  if (!header) return false;
  const match = SIGNATURE_RE.exec(header.trim());
  if (!match) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(match[1], "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

// ---------------------------------------------------------------------------
// Webhook event classification — pure, no DB.
// ---------------------------------------------------------------------------

export type WebhookDecision = { kind: "ping" } | { kind: "ignored" } | { kind: "import"; ref: string };

/**
 * Classifies one webhook delivery: `ping` is answered directly; a *published*
 * release or a pushed tag (`refs/tags/...`) both mean "import at this tag";
 * anything else (a draft release, a branch push, an unrelated event type) is
 * ignored. Ignoring is a 200, not an error — GitHub retries non-2xx deliveries,
 * and there's nothing about "we don't act on this event" that a retry would fix.
 */
export function classifyEvent(eventName: string, payload: unknown): WebhookDecision {
  const body = (payload ?? {}) as Record<string, unknown>;

  if (eventName === "ping") return { kind: "ping" };

  if (eventName === "release") {
    const release = body.release as Record<string, unknown> | undefined;
    const tagName = release?.tag_name;
    if (body.action === "published" && typeof tagName === "string" && tagName) {
      return { kind: "import", ref: tagName };
    }
    return { kind: "ignored" };
  }

  if (eventName === "push") {
    const ref = body.ref;
    if (typeof ref === "string" && ref.startsWith("refs/tags/")) {
      const tag = ref.slice("refs/tags/".length);
      if (tag) return { kind: "import", ref: tag };
    }
    return { kind: "ignored" };
  }

  return { kind: "ignored" };
}

/** Pulls `repository.full_name` out of a webhook payload, or undefined if absent
 *  or the wrong shape — used to confirm a delivery actually names the linked repo. */
export function payloadRepoFullName(payload: unknown): string | undefined {
  const body = (payload ?? {}) as Record<string, unknown>;
  const repository = body.repository as Record<string, unknown> | undefined;
  const fullName = repository?.full_name;
  return typeof fullName === "string" ? fullName : undefined;
}

// ---------------------------------------------------------------------------
// Version decision — pure, no DB.
// ---------------------------------------------------------------------------

export type SyncDecision = { publish: true } | { publish: false; message: string };

/**
 * Whether an imported manifest version should actually be published: strictly
 * greater precedence than the package's current version, per semver.org (see
 * `isGreater` in semver.ts). An unparseable version (should be unreachable —
 * both sides already passed the manifest schema's semver regex at their own
 * publish time — but a webhook is untrusted input) is treated as "don't publish"
 * rather than thrown, so a single bad delivery can't crash the route.
 */
export function decideSync(importedVersion: string, currentVersion: string): SyncDecision {
  try {
    if (isGreater(importedVersion, currentVersion)) return { publish: true };
    return {
      publish: false,
      message: `version ${importedVersion} is not greater than ${currentVersion}`,
    };
  } catch (err) {
    if (err instanceof SemverError) return { publish: false, message: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

type Db = NonNullable<ReturnType<typeof getDb>>;

function requireDb(): Db {
  const db = getDb();
  if (!db) {
    throw new SourceError(503, "GitHub sync requires a database; none is configured on this deployment");
  }
  return db;
}

/** The one link for `owner/name`, or null if none / no database. */
export async function getSourceByPackage(owner: string, name: string): Promise<SourceRow | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(packageSources)
    .where(and(eq(packageSources.owner, owner), eq(packageSources.name, name)))
    .limit(1);
  return row ?? null;
}

/** Looked up by the webhook route, which only has the link id from the URL. */
export async function getSourceById(id: string): Promise<SourceRow | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select().from(packageSources).where(eq(packageSources.id, id)).limit(1);
  return row ?? null;
}

export interface LinkSourceArgs {
  owner: string;
  name: string;
  userId: string;
  repo: string;
  ref?: string;
  subdir?: string;
}

/**
 * Creates (or replaces) the link for `owner/name`. Always mints a fresh id, so a
 * re-link — same package, new repo, or just regenerating after a key rotation —
 * rotates the webhook URL and secret too; the GitHub setup steps already tell the
 * seller to (re-)add the webhook, so there's no link that silently keeps working
 * with a stale id. `package_sources` has a unique (owner, name) constraint and no
 * incoming foreign keys, so a delete-then-insert is a safe, simple upsert here.
 * neon-http has no transactions (see the same tradeoff, and why, in publish.ts) —
 * this accepts the same small race window.
 */
export async function linkSource(args: LinkSourceArgs): Promise<{ row: SourceRow; secret: string }> {
  const key = webhookKey();
  if (!key) throw new SourceError(503, "GitHub sync is not configured");

  const db = requireDb();
  const id = randomUUID();
  const secret = deriveSecret(id, key);
  const secretHash = hashSecret(secret);

  await db
    .delete(packageSources)
    .where(and(eq(packageSources.owner, args.owner), eq(packageSources.name, args.name)));

  const [row] = await db
    .insert(packageSources)
    .values({
      id,
      owner: args.owner,
      name: args.name,
      userId: args.userId,
      repo: args.repo,
      ref: args.ref ?? null,
      subdir: args.subdir ?? null,
      secretHash,
    })
    .returning();

  return { row, secret };
}

/** True if a link existed and was removed. */
export async function unlinkSource(owner: string, name: string): Promise<boolean> {
  const db = requireDb();
  const deleted = await db
    .delete(packageSources)
    .where(and(eq(packageSources.owner, owner), eq(packageSources.name, name)))
    .returning({ id: packageSources.id });
  return deleted.length > 0;
}

/** Records the outcome of a sync attempt (manual or webhook-triggered). Best-effort:
 *  swallows a missing database rather than letting bookkeeping fail the response
 *  the caller already computed. */
export async function recordSyncResult(id: string, result: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(packageSources)
    .set({ lastSyncedAt: new Date(), lastResult: result })
    .where(eq(packageSources.id, id));
}
