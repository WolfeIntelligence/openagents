// "Publish from a GitHub repo URL" (audit gap, see docs/AUDIT-2026-09.md). Downloads a
// repo tarball from GitHub's codeload service and turns it into the same PublishFile[]
// shape the directory-upload publish flow produces, so both paths share `publishPackage`
// and its validation.
//
// No env vars required — this only talks to GitHub's public codeload endpoint, which
// needs no token for public repos.

import { Readable } from "node:stream";
import zlib from "node:zlib";
import * as tar from "tar-stream";
import type { PublishFile } from "@/lib/publish";
import { isProbablyBinary, MAX_BINARY_BYTES } from "@/lib/files";

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
 * Downloads and extracts a GitHub repo (or a subdirectory of one) into `PublishFile[]`,
 * applying the same limits `publishPackage` applies to a direct upload. `ref` and
 * `subdir` passed explicitly win over anything parsed from a `/tree/{ref}/{subdir}`
 * URL. Throws `GitHubImportError` if `openagent.yaml` isn't found at the resolved root.
 */
export async function fetchGitHubPackageFiles(
  repoUrl: string,
  ref?: string,
  subdir?: string
): Promise<PublishFile[]> {
  const parsed = parseGitHubRepoUrl(repoUrl);
  const finalRef = ref?.trim() || parsed.ref;
  const finalSubdir = normalizeSubdir(subdir?.trim() || parsed.subdir);

  const body = await fetchTarball(parsed.owner, parsed.repo, finalRef);
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

  if (!files.some((f) => f.path === "openagent.yaml")) {
    throw new GitHubImportError(400, [
      finalSubdir
        ? `openagent.yaml not found in "${finalSubdir}/" of ${parsed.owner}/${parsed.repo}@${finalRef}`
        : `openagent.yaml not found at the root of ${parsed.owner}/${parsed.repo}@${finalRef} (pass a subdir if the package lives in one)`,
    ]);
  }

  return files;
}
