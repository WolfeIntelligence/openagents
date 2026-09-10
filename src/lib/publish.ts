// Publishing pipeline: takes raw uploaded files, validates openagent.yaml, and writes
// package + version + file rows to Postgres. Requires the DB to be enabled — callers
// (the publish route) should check isDbEnabled() first and return 503 otherwise.

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packageFiles, packages, packageVersions, users } from "@/lib/db/schema";
import { ManifestError, parseManifest, validateManifestFiles } from "@/lib/manifest";
import { isGreater, SemverError } from "@/lib/semver";
import { isReservedHandle } from "@/lib/reserved";

export interface PublishFile {
  path: string;
  content: string;
}

export interface PublishArgs {
  /** The authenticated caller's handle. Must match manifest.owner. */
  userHandle: string;
  files: PublishFile[];
  /** Optional "what changed" note for this version. Falls back to CHANGELOG.md's first section. */
  changelog?: string;
}

export interface PublishResult {
  /** "owner/name" — matches the Package.id shape used everywhere else in the app. */
  id: string;
  version: string;
  /** Path to the published package's page. */
  url: string;
  /** The package's lifecycle status after this publish (see `packages.status`). */
  status: string;
}

/** Thrown for any publish failure; `status` is the HTTP status the route should return. */
export class PublishError extends Error {
  status: number;
  errors: string[];

  constructor(status: number, errors: string[]) {
    super(errors[0] ?? "publish failed");
    this.name = "PublishError";
    this.status = status;
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Upload hygiene (G-M3, cheap part) — limits that don't require parsing the
// manifest, so they run before we even look for openagent.yaml. Keeps a
// malicious or broken upload from reaching the manifest parser, the DB, or
// the file-viewer/tarball routes downstream.
// ---------------------------------------------------------------------------

const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024; // 512 KB
const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 2 MB

function isUnsafePath(p: string): string | null {
  if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p)) return "absolute paths are not allowed";
  if (p.includes("..")) return `".." is not allowed`;
  if (p.includes("\\")) return "backslashes are not allowed, use /";
  if (p.includes("\u0000")) return "NUL bytes are not allowed";
  return null;
}

/** Returns a (possibly empty) list of upload-level error strings. Does not throw. */
function validateUpload(files: PublishFile[]): string[] {
  const errors: string[] = [];

  if (files.length > MAX_FILES) {
    errors.push(`too many files: ${files.length} (max ${MAX_FILES})`);
  }

  let totalBytes = 0;
  for (const f of files) {
    const reason = isUnsafePath(f.path);
    if (reason) {
      errors.push(`invalid file path "${f.path}": ${reason}`);
      continue;
    }

    const size = Buffer.byteLength(f.content, "utf8");
    totalBytes += size;
    if (size > MAX_FILE_BYTES) {
      errors.push(`file too large: ${f.path} (${size} bytes, max ${MAX_FILE_BYTES})`);
    }
    if (f.content.includes("\u0000")) {
      errors.push(`binary files are not supported yet: ${f.path}`);
    }
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    errors.push(`upload too large: ${totalBytes} bytes total (max ${MAX_TOTAL_BYTES})`);
  }

  if (!files.some((f) => f.path.toLowerCase() === "readme.md")) {
    errors.push("README.md is required");
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Changelog (B6d)
// ---------------------------------------------------------------------------

const MAX_CHANGELOG_CHARS = 4000;

/**
 * Text of CHANGELOG.md's first section: from its first ATX heading (`#`..`######`)
 * up to (not including) the next heading of the same level, or end of file.
 * Returns undefined for a file with no heading and no other content.
 */
function extractChangelogSection(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const headingRe = /^(#{1,6})\s+/;

  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (m) {
      start = i;
      level = m[1].length;
      break;
    }
  }

  if (start === -1) {
    const whole = content.trim();
    return whole ? whole.slice(0, MAX_CHANGELOG_CHARS) : undefined;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }

  const section = lines.slice(start, end).join("\n").trim();
  return section ? section.slice(0, MAX_CHANGELOG_CHARS) : undefined;
}

/** True for a Postgres unique-violation error surfaced by the Neon driver (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "23505");
}

export async function publishPackage({ userHandle, files, changelog }: PublishArgs): Promise<PublishResult> {
  const db = getDb();
  if (!db) throw new PublishError(503, ["database not configured"]);

  const uploadErrors = validateUpload(files);
  if (uploadErrors.length) throw new PublishError(400, uploadErrors);

  const manifestFile = files.find((f) => f.path === "openagent.yaml");
  if (!manifestFile) throw new PublishError(400, ["missing openagent.yaml"]);

  let manifest;
  try {
    manifest = parseManifest(manifestFile.content);
  } catch (err) {
    if (err instanceof ManifestError) throw new PublishError(400, err.issues);
    throw new PublishError(400, [err instanceof Error ? err.message : String(err)]);
  }

  if (manifest.owner !== userHandle) {
    throw new PublishError(400, [
      `manifest owner "${manifest.owner}" does not match your handle "${userHandle}"`,
    ]);
  }

  // Defense-in-depth: handle derivation (auth.ts) already keeps reserved words and seed
  // catalog owners from being assigned to a user, but a caller could still hand-craft a
  // manifest with a reserved owner, so re-check it here too (B12a).
  if (isReservedHandle(manifest.owner)) {
    throw new PublishError(403, ["owner handle is reserved"]);
  }

  if (manifest.pricing.model === "subscription" && !manifest.pricing.interval) {
    throw new PublishError(400, [
      'subscription pricing needs pricing.interval ("month" or "year")',
    ]);
  }

  if (!/^[a-z]{3}$/.test(manifest.pricing.currency)) {
    throw new PublishError(400, [
      `currency must be a 3-letter lowercase ISO 4217 code, e.g. "usd" (got "${manifest.pricing.currency}")`,
    ]);
  }

  if (manifest.pricing.model !== "free") {
    const [seller] = await db
      .select({ stripeOnboarded: users.stripeOnboarded })
      .from(users)
      .where(eq(users.handle, userHandle))
      .limit(1);
    if (!seller?.stripeOnboarded) {
      throw new PublishError(400, [
        "Connect Stripe payouts before publishing a paid package (Settings → Payouts).",
      ]);
    }
  }

  const fileErrors = validateManifestFiles(
    manifest,
    files.map((f) => f.path)
  );
  if (fileErrors.length) throw new PublishError(400, fileErrors);

  const readmeFile = files.find((f) => f.path.toLowerCase() === "readme.md");

  // Resolve the changelog: an explicit field wins (trimmed, capped); otherwise fall back
  // to CHANGELOG.md's first section if the upload includes one.
  let resolvedChangelog: string | undefined;
  if (typeof changelog === "string") {
    const trimmed = changelog.trim();
    if (trimmed.length > MAX_CHANGELOG_CHARS) {
      throw new PublishError(400, [
        `changelog must be ${MAX_CHANGELOG_CHARS} characters or fewer (got ${trimmed.length})`,
      ]);
    }
    resolvedChangelog = trimmed.length ? trimmed : undefined;
  }
  if (!resolvedChangelog) {
    const changelogFile = files.find((f) => f.path.toLowerCase() === "changelog.md");
    if (changelogFile) resolvedChangelog = extractChangelogSection(changelogFile.content);
  }

  const packageValues = {
    kind: manifest.kind,
    title: manifest.title,
    summary: manifest.summary,
    license: manifest.license,
    tags: manifest.tags,
    runtimes: manifest.runtimes,
    pricingModel: manifest.pricing.model,
    amountCents: manifest.pricing.amountCents,
    currency: manifest.pricing.currency,
    entry: manifest.entry,
    latestVersion: manifest.version,
  };

  // neon-http has no transactions; these run sequentially and are accepted as such.
  const [existing] = await db
    .select({ id: packages.id, latestVersion: packages.latestVersion, status: packages.status })
    .from(packages)
    .where(and(eq(packages.owner, manifest.owner), eq(packages.name, manifest.name)))
    .limit(1);

  if (existing) {
    const [duplicate] = await db
      .select({ id: packageVersions.id })
      .from(packageVersions)
      .where(and(eq(packageVersions.packageId, existing.id), eq(packageVersions.version, manifest.version)))
      .limit(1);
    if (duplicate) {
      throw new PublishError(409, [
        `version ${manifest.version} is already published; bump the version (versions are immutable)`,
      ]);
    }

    let versionIsGreater: boolean;
    try {
      versionIsGreater = isGreater(manifest.version, existing.latestVersion);
    } catch (err) {
      // manifest.version already passed the manifest schema's semver regex, so this can
      // only happen for an existing.latestVersion written before that check existed.
      if (err instanceof SemverError) throw new PublishError(400, [err.message]);
      throw err;
    }
    if (!versionIsGreater) {
      throw new PublishError(400, [
        `version ${manifest.version} must be greater than the current ${existing.latestVersion}`,
      ]);
    }
  }

  let packageId: string;
  let resultStatus: string;
  if (existing) {
    // Updates never touch status: a re-publish of an already-live (or already-pending,
    // already-unlisted...) package shouldn't silently change its moderation state —
    // only the review queue (or REQUIRE_REVIEW at initial creation) does that.
    packageId = existing.id;
    resultStatus = existing.status;
    await db
      .update(packages)
      .set({ ...packageValues, updatedAt: new Date() })
      .where(eq(packages.id, packageId));
  } else {
    // G-T1/S9 follow-on: when review is required, a brand-new package starts hidden
    // from listings/search until an admin approves it (see `packages.status` doc
    // comment in schema.ts) rather than going live immediately.
    const initialStatus = process.env.REQUIRE_REVIEW === "1" ? "pending" : "live";
    const [row] = await db
      .insert(packages)
      .values({ owner: manifest.owner, name: manifest.name, ...packageValues, status: initialStatus })
      .returning({ id: packages.id, status: packages.status });
    packageId = row.id;
    resultStatus = row.status;
  }

  let versionRow: { id: string };
  try {
    [versionRow] = await db
      .insert(packageVersions)
      .values({
        packageId,
        version: manifest.version,
        manifest,
        readme: readmeFile?.content ?? "",
        changelog: resolvedChangelog,
      })
      .returning({ id: packageVersions.id });
  } catch (err) {
    // A race with another publish of the same (packageId, version) — the app-level check
    // above already caught the common case, this is the DB's unique constraint catching
    // the concurrent one. Same user-facing error either way.
    if (isUniqueViolation(err)) {
      throw new PublishError(409, [
        `version ${manifest.version} is already published; bump the version (versions are immutable)`,
      ]);
    }
    throw err;
  }

  if (files.length) {
    await db.insert(packageFiles).values(
      files.map((f) => ({
        versionId: versionRow.id,
        path: f.path,
        size: Buffer.byteLength(f.content, "utf8"),
        content: f.content,
      }))
    );
  }

  return {
    id: `${manifest.owner}/${manifest.name}`,
    version: manifest.version,
    url: `/p/${manifest.owner}/${manifest.name}`,
    status: resultStatus,
  };
}
