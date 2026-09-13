// "Publish from a GitHub repo URL" (audit gap, see docs/AUDIT-2026-09.md). Downloads a
// repo tarball from GitHub's codeload service and turns it into the same PublishFile[]
// shape the directory-upload publish flow produces, so both paths share `publishPackage`
// and its validation.
//
// Also covers the store/import-with-manifest workstream: most repos a scout agent finds
// don't carry their own openagent.yaml, so `resolveImportManifest` lets the import route
// fall back to a caller-proposed manifest draft when the repo has none, validated the
// same way a real one would be, with `origin` forced to the actual fetched repo/commit
// either way, and (when a proposal is what wins) `attested_by` forced to record who
// proposed it — see its doc comment.
//
// No env vars required — this only talks to GitHub's public codeload and REST API
// endpoints, neither of which needs a token for public repos.

import { Readable } from "node:stream";
import zlib from "node:zlib";
import * as tar from "tar-stream";
import { parseDocument } from "yaml";
import type { PublishFile } from "@/lib/publish";
import { isProbablyBinary, MAX_BINARY_BYTES } from "@/lib/files";
import { ManifestError, parseManifest, validateManifestFiles } from "@/lib/manifest";
import type { ManifestAttestation, ManifestOrigin } from "@/lib/types";

/** Thrown for any import failure; `status` is the HTTP status the route should return. */
export class GitHubImportError extends Error {
  status: number;
  errors: string[];

  constructor(status: number, errors: string[]) {
    super(errors[0] ?? "github import failed");
    this.name = "GitHubImportError";
    this.status = status;
    this.errors = errors;
  }
}

export interface ParsedGitHubRepo {
  owner: string;
  repo: string;
  /** From a `/tree/{ref}/...` URL; "HEAD" (the default branch) when absent. */
  ref: string;
  /** From the rest of a `/tree/{ref}/{subdir}` URL; undefined for the repo root. */
  subdir?: string;
}

const OWNER_RE = /^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/;
const REPO_RE = /^[\w.-]{1,100}$/;

/**
 * Strictly validates a GitHub repo URL and pulls out its parts. Only
 * `github.com/{owner}/{repo}` and `github.com/{owner}/{repo}/tree/{ref}/{subdir}` are
 * accepted — no `blob`, `raw.githubusercontent.com`, gists, or other hosts, since those
 * either aren't a repo root or open the door to fetching arbitrary files instead of a
 * package tree.
 */
export function parseGitHubRepoUrl(input: string): ParsedGitHubRepo {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GitHubImportError(400, [`not a valid URL: "${input}"`]);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GitHubImportError(400, [`unsupported URL scheme: "${url.protocol}"`]);
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new GitHubImportError(400, [`only github.com repo URLs are supported (got "${url.hostname}")`]);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new GitHubImportError(400, [
      `expected https://github.com/{owner}/{repo}, got "${input}"`,
    ]);
  }

  const [ownerRaw, repoRaw, ...rest] = segments;
  const repo = repoRaw.replace(/\.git$/, "");

  if (!OWNER_RE.test(ownerRaw) || !REPO_RE.test(repo)) {
    throw new GitHubImportError(400, [`not a valid github.com/{owner}/{repo} URL: "${input}"`]);
  }

  if (rest.length === 0) {
    return { owner: ownerRaw, repo, ref: "HEAD" };
  }

  if (rest[0] !== "tree") {
    throw new GitHubImportError(400, [
      `unsupported GitHub URL form: "${input}" (expected .../tree/{ref}/{subdir})`,
    ]);
  }
  if (rest.length < 2) {
    throw new GitHubImportError(400, [`missing ref after "/tree/" in "${input}"`]);
  }

  const ref = decodeURIComponent(rest[1]);
  const subdir = rest.length > 2 ? rest.slice(2).map(decodeURIComponent).join("/") : undefined;

  return { owner: ownerRaw, repo, ref, subdir };
}

// ---------------------------------------------------------------------------
// Same upload-hygiene limits as publishPackage's cheap pre-manifest checks
// (src/lib/publish.ts) — a GitHub import should be no more permissive than a
// direct directory upload.
// ---------------------------------------------------------------------------

const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024; // 512 KB
const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 2 MB
const FETCH_TIMEOUT_MS = 10_000;

function normalizeSubdir(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return undefined;
  if (trimmed.split("/").includes("..")) {
    throw new GitHubImportError(400, [`invalid subdir: "${raw}"`]);
  }
  return trimmed;
}

async function fetchTarball(owner: string, repo: string, ref: string): Promise<ReadableStream<Uint8Array>> {
  const url = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${encodeURIComponent(ref)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, redirect: "follow" });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GitHubImportError(504, [`timed out fetching ${owner}/${repo}@${ref} from GitHub`]);
    }
    throw new GitHubImportError(502, [
      `failed to fetch ${owner}/${repo}@${ref} from GitHub: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 404) {
    throw new GitHubImportError(404, [`repo or ref not found: ${owner}/${repo}@${ref}`]);
  }
  if (!res.ok || !res.body) {
    throw new GitHubImportError(502, [`GitHub returned ${res.status} for ${owner}/${repo}@${ref}`]);
  }
  return res.body;
}

/**
 * Resolves `ref` (a branch, tag, "HEAD", or an already-full sha) to the full
 * 40-char commit sha it currently points at, via GitHub's REST API "sha media
 * type" (a plain-text response, not JSON — no need to pull in a JSON commit
 * shape just for one field). Only called when a caller asks for it
 * (`fetchGitHubPackageFiles`'s `resolveCommit` option) — the webhook and
 * manual-sync callers don't need it and shouldn't pay for an extra GitHub API
 * round trip (with its own rate limit and failure mode) on every sync.
 */
async function resolveCommitSha(owner: string, repo: string, ref: string): Promise<string> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      // api.github.com (unlike codeload.github.com) 403s an unauthenticated
      // request with no User-Agent header.
      headers: { Accept: "application/vnd.github.sha", "User-Agent": "openagents-import" },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GitHubImportError(504, [`timed out resolving ${owner}/${repo}@${ref} to a commit`]);
    }
    throw new GitHubImportError(502, [
      `failed to resolve ${owner}/${repo}@${ref} to a commit: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 404) {
    throw new GitHubImportError(404, [`repo or ref not found: ${owner}/${repo}@${ref}`]);
  }
  if (!res.ok) {
    throw new GitHubImportError(502, [`GitHub returned ${res.status} resolving ${owner}/${repo}@${ref} to a commit`]);
  }

  const sha = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new GitHubImportError(502, [`GitHub returned an unexpected response resolving ${owner}/${repo}@${ref} to a commit`]);
  }
  return sha;
}

export interface GitHubImportResult {
  files: PublishFile[];
  owner: string;
  repo: string;
  /** The ref actually fetched: an explicit `ref` arg, the `/tree/{ref}/...`
   *  segment of `repoUrl`, or "HEAD" — never a resolved sha even when
   *  `commit` below is populated. */
  ref: string;
  subdir?: string;
  /** The full 40-char commit sha `ref` resolved to. Only populated when
   *  `options.resolveCommit` was passed (see `fetchGitHubPackageFiles`). */
  commit?: string;
}

/**
 * Downloads and extracts a GitHub repo (or a subdirectory of one) into `PublishFile[]`,
 * applying the same limits `publishPackage` applies to a direct upload. `ref` and
 * `subdir` passed explicitly win over anything parsed from a `/tree/{ref}/{subdir}`
 * URL.
 *
 * By default, throws `GitHubImportError` if `openagent.yaml` isn't found at the
 * resolved root — pass `options.requireManifest: false` to skip that check and get
 * back whatever was found instead (the import route uses this so it can fall back to
 * a caller-proposed manifest; see `resolveImportManifest` below).
 *
 * `options.resolveCommit: true` additionally resolves `ref` to the exact commit sha it
 * points at (one extra GitHub API call) and fetches that exact commit's tarball rather
 * than trusting codeload to independently re-resolve a possibly-moving ref (a branch
 * push landing between the two calls) — so `commit` in the result always matches
 * `files` exactly. Defaults to false: the webhook and manual-sync callers don't need
 * `commit` and shouldn't pay for the extra round trip (and its own rate limit/failure
 * mode) on every sync.
 */
export async function fetchGitHubPackageFiles(
  repoUrl: string,
  ref?: string,
  subdir?: string,
  options?: { requireManifest?: boolean; resolveCommit?: boolean }
): Promise<GitHubImportResult> {
  const parsed = parseGitHubRepoUrl(repoUrl);
  const finalRef = ref?.trim() || parsed.ref;
  const finalSubdir = normalizeSubdir(subdir?.trim() || parsed.subdir);
  const requireManifest = options?.requireManifest ?? true;

  const commit = options?.resolveCommit
    ? await resolveCommitSha(parsed.owner, parsed.repo, finalRef)
    : undefined;
  const body = await fetchTarball(parsed.owner, parsed.repo, commit ?? finalRef);
  const nodeStream = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
  const gunzip = zlib.createGunzip();
  const extract = tar.extract();

  const files: PublishFile[] = [];
  let totalBytes = 0;
  let fileCount = 0;
  // GitHub's tarball always wraps everything in one top-level "{repo}-{ref}/" directory;
  // strip whatever that turns out to be rather than hardcoding its name (codeload
  // sanitizes refs into it in ways not worth reverse-engineering).
  let rootPrefix: string | null = null;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    extract.on("entry", (header, entryStream, next) => {
      if (header.type !== "file") {
        entryStream.resume();
        entryStream.on("end", next);
        entryStream.on("error", fail);
        return;
      }

      const chunks: Buffer[] = [];
      entryStream.on("data", (chunk) => {
        chunks.push(chunk as Buffer);
      });
      entryStream.on("error", fail);
      entryStream.on("end", () => {
        let entryPath = header.name;
        const slashIdx = entryPath.indexOf("/");
        if (rootPrefix === null) {
          rootPrefix = slashIdx === -1 ? "" : entryPath.slice(0, slashIdx + 1);
        }
        if (rootPrefix && entryPath.startsWith(rootPrefix)) {
          entryPath = entryPath.slice(rootPrefix.length);
        }
        if (!entryPath) {
          next();
          return;
        }

        if (finalSubdir) {
          const prefix = `${finalSubdir}/`;
          if (!entryPath.startsWith(prefix)) {
            next();
            return;
          }
          entryPath = entryPath.slice(prefix.length);
          if (!entryPath) {
            next();
            return;
          }
        }

        fileCount += 1;
        if (fileCount > MAX_FILES) {
          fail(new GitHubImportError(400, [`too many files in repo (max ${MAX_FILES})`]));
          return;
        }

        const buf = Buffer.concat(chunks);
        const binary = isProbablyBinary(buf);
        // Text still gets the flat 512KB cap; binary content gets the larger
        // MAX_BINARY_BYTES ceiling (mirrors publish.ts's own per-file limits).
        // An oversized file is skipped rather than failing the whole import —
        // a repo can have a `dist/` or a huge asset `openagent.yaml` never
        // references, and that shouldn't block importing the files that matter.
        if (buf.length > (binary ? MAX_BINARY_BYTES : MAX_FILE_BYTES)) {
          next();
          return;
        }

        totalBytes += buf.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          fail(new GitHubImportError(400, [`repo too large to import (max ${MAX_TOTAL_BYTES} bytes)`]));
          return;
        }

        // tar's mode is the full POSIX permission bits (e.g. 0o100755); any
        // execute bit set means the registry should preserve it as 0o755.
        const mode = header.mode && (header.mode & 0o111) !== 0 ? 0o755 : undefined;

        files.push(
          binary
            ? { path: entryPath, content: buf.toString("base64"), encoding: "base64", mode }
            : { path: entryPath, content: buf.toString("utf8"), mode }
        );
        next();
      });
    });

    extract.on("finish", succeed);
    extract.on("error", fail);
    gunzip.on("error", fail);
    nodeStream.on("error", fail);

    nodeStream.pipe(gunzip).pipe(extract);
  });

  if (requireManifest && !files.some((f) => f.path === "openagent.yaml")) {
    throw new GitHubImportError(400, [
      finalSubdir
        ? `openagent.yaml not found in "${finalSubdir}/" of ${parsed.owner}/${parsed.repo}@${finalRef}`
        : `openagent.yaml not found at the root of ${parsed.owner}/${parsed.repo}@${finalRef} (pass a subdir if the package lives in one)`,
    ]);
  }

  return { files, owner: parsed.owner, repo: parsed.repo, ref: finalRef, subdir: finalSubdir, commit };
}

// ---------------------------------------------------------------------------
// Proposed-manifest import (store/import-with-manifest) — lets a caller of
// POST /api/v1/publish/import supply an openagent.yaml draft to use when the
// target repo doesn't have one of its own. See the route for the full flow.
// ---------------------------------------------------------------------------

export type ManifestSource = "repo" | "proposed";

export interface ResolvedImport {
  files: PublishFile[];
  /** Which manifest governed this import — the response surfaces this so a
   *  caller (e.g. the scout agent) knows whether its proposal was actually
   *  used or the repo turned out to already have its own. */
  manifestSource: ManifestSource;
}

/**
 * Rewrites `yamlText`'s top-level `origin` field to `origin`, and, when `attestedBy`
 * is given, its top-level `attested_by` field too, preserving every other field,
 * comment, and formatting choice (via `yaml`'s Document API rather than a
 * parse-then-reserialize round trip). `origin` is always forced so neither a repo's
 * own openagent.yaml nor a caller-proposed one can claim a different origin than
 * where the content was actually fetched from; `attestedBy` is forced the same way,
 * for the same reason, only on the proposed-manifest path — see `resolveImportManifest`.
 *
 * Malformed YAML is left untouched: for a repo's own manifest, publishPackage's
 * own `parseManifest` call raises the same syntax error downstream (unchanged
 * behavior); for a proposal, `resolveImportManifest` already validated it with
 * `parseManifest` before ever reaching here, so this branch is unreachable for
 * that case in practice, not silently swallowed.
 */
function withForcedProvenance(yamlText: string, origin: ManifestOrigin, attestedBy?: ManifestAttestation): string {
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) return yamlText;
  doc.set("origin", { repo: origin.repo, commit: origin.commit });
  if (attestedBy) {
    doc.set("attested_by", attestedBy.runId ? { name: attestedBy.name, run_id: attestedBy.runId } : { name: attestedBy.name });
  }
  return String(doc);
}

/**
 * Decides which openagent.yaml governs a GitHub import and returns the final
 * `files` array `publishPackage` should receive:
 *
 *   - The repo's own openagent.yaml (already in `fetched.files`) always wins when
 *     present — `proposedManifest` is ignored entirely, not even parsed.
 *   - Otherwise, `proposedManifest` (raw YAML text, the same shape a repo's own
 *     openagent.yaml would hold) is parsed and cross-checked against the fetched
 *     tree exactly like a real manifest (`parseManifest` + `validateManifestFiles`)
 *     and, if it passes, added to the returned files as openagent.yaml.
 *   - Neither present: throws `GitHubImportError(400, ...)`, the same "openagent.yaml
 *     not found" shape `fetchGitHubPackageFiles` used to throw itself.
 *
 * Either way, the winning manifest's `origin` is overwritten with `fetched`'s actual
 * repo and resolved commit (see `withForcedProvenance`) before `publishPackage` ever
 * sees it — a proposal (or a repo's own manifest) cannot claim a different origin than
 * where this import actually fetched its content from.
 *
 * When a proposal is what wins, `importedBy` (when passed — the import route's caller
 * identity, per PR #13's provenance fields) is likewise force-written as the manifest's
 * `attested_by`, overwriting anything the proposal itself claimed there: the whole point
 * of this field, per its doc comment on `ManifestAttestation`, is recording who actually
 * ran the publish, and a caller-drafted proposal is no more trustworthy about that than
 * it is about `origin`. The repo's own openagent.yaml, when present, keeps whatever
 * `attested_by` (if any) it already carries — that's a fact about the origin repo, not
 * about this import, and `importedBy` is ignored for that branch entirely.
 *
 * Deliberately does *not* re-run publishPackage's other checks (owner match, pricing,
 * content scan, reserved-handle, ...) — those run exactly once, unchanged, when the
 * caller hands the returned `files` to `publishPackage`. Duplicating them here would
 * only risk the two drifting apart.
 */
export function resolveImportManifest(
  fetched: Pick<GitHubImportResult, "files" | "owner" | "repo" | "ref" | "subdir"> & { commit: string },
  proposedManifest: string | undefined,
  importedBy?: ManifestAttestation
): ResolvedImport {
  const origin: ManifestOrigin = { repo: `github.com/${fetched.owner}/${fetched.repo}`, commit: fetched.commit };
  const repoManifest = fetched.files.find((f) => f.path === "openagent.yaml");

  if (repoManifest) {
    return {
      manifestSource: "repo",
      files: fetched.files.map((f) =>
        f.path === "openagent.yaml" ? { ...f, content: withForcedProvenance(f.content, origin) } : f
      ),
    };
  }

  const proposedText = proposedManifest?.trim();
  if (!proposedText) {
    throw new GitHubImportError(400, [
      fetched.subdir
        ? `openagent.yaml not found in "${fetched.subdir}/" of ${fetched.owner}/${fetched.repo}@${fetched.ref}, and no manifest was proposed`
        : `openagent.yaml not found at the root of ${fetched.owner}/${fetched.repo}@${fetched.ref} (pass a subdir, or propose a manifest)`,
    ]);
  }

  let manifest;
  try {
    manifest = parseManifest(proposedText);
  } catch (err) {
    if (err instanceof ManifestError) throw new GitHubImportError(400, err.issues);
    throw new GitHubImportError(400, [err instanceof Error ? err.message : String(err)]);
  }

  const fileErrors = validateManifestFiles(
    manifest,
    fetched.files.map((f) => f.path)
  );
  if (fileErrors.length) throw new GitHubImportError(400, fileErrors);

  return {
    manifestSource: "proposed",
    files: [
      ...fetched.files,
      { path: "openagent.yaml", content: withForcedProvenance(proposedText, origin, importedBy) },
    ],
  };
}
