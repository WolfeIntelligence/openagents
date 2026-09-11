// Builds a gzip'd tarball of a package (`openagent.yaml`, `README.md`, and
// every file declared in the manifest), rooted under an `<owner>-<name>/`
// prefix — used by the download routes (latest and per-version) and
// (indirectly) the CLI's `add`.
//
// Output is byte-for-byte deterministic for identical input (G-V4): the same
// package version always produces the same gzip bytes, so its sha256 can be
// used as a stable ETag/checksum and the CLI can verify what it downloaded.
// Two sources of nondeterminism had to be pinned down to get there — see
// FIXED_MTIME and the sorted `relativePaths` below. `gzipSync` itself already
// writes a zeroed MTIME field in the gzip header (verified against Node's
// zlib binding), so no extra work was needed on the gzip side.

import { pack } from "tar-stream";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { decodeContent } from "@/lib/files";
import type { Package, PackageFile } from "@/lib/types";

/** Fetches one file's content by package-relative path. Mirrors `Catalog["getFile"]` curried on owner/name. */
export type GetFileFn = (path: string) => Promise<PackageFile | null>;

/** Written into every tar entry's header instead of a real mtime. Real file
 *  mtimes vary by filesystem, checkout, and deploy, so leaving tar-stream's
 *  default (`new Date()` per entry) would make the gzip — and therefore its
 *  sha256 — different on every build even for byte-identical file content. */
const FIXED_MTIME = new Date(0);

/** Mode written for a file whose `PackageFile.mode` is unset — a plain,
 *  non-executable file. */
const DEFAULT_FILE_MODE = 0o644;

export interface TarballWithDigest {
  buffer: Buffer;
  /** Hex-encoded sha256 of the gzip bytes — used for `ETag` and `X-Checksum-Sha256`. */
  sha256: string;
}

/** Packs `openagent.yaml`, `README.md`, and `pkg.manifest.files` into a gzip tar under `<owner>-<name>/`. */
export async function packageTarball(pkg: Package, getFile: GetFileFn): Promise<Buffer> {
  return (await packageTarballWithDigest(pkg, getFile)).buffer;
}

/** Same output as `packageTarball`, plus the sha256 digest of the gzip bytes,
 *  computed in the same pass rather than making every call site re-hash the
 *  buffer itself. */
export async function packageTarballWithDigest(pkg: Package, getFile: GetFileFn): Promise<TarballWithDigest> {
  const prefix = `${pkg.owner}-${pkg.name}`;
  // Sorted rather than left in Set-insertion order: the tar's entry order must
  // never depend on the order manifest.files happens to list things (which can
  // vary between a fresh publish and however Postgres returns the row), or the
  // same file set would pack into different — if equally valid — tar bytes.
  const relativePaths = Array.from(
    new Set<string>(["openagent.yaml", "README.md", pkg.manifest.entry, ...pkg.manifest.files])
  ).sort();

  // Load every file first, then write all tar entries while a consumer is
  // already attached. Awaiting each entry before anything reads the stream
  // deadlocks as soon as the package exceeds the stream's internal buffer.
  const files: { relPath: string; buf: Buffer; mode: number }[] = [];
  for (const relPath of relativePaths) {
    const file = await getFile(relPath);
    if (!file || file.content === undefined) continue; // not found / not allowed — skip
    // decodeContent honors file.encoding, so a binary file's base64 content
    // round-trips into the tarball as the original bytes, not the base64 text.
    files.push({ relPath, buf: decodeContent(file), mode: file.mode ?? DEFAULT_FILE_MODE });
  }

  const tarPack = pack();
  const collected = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    tarPack.on("data", (chunk) => chunks.push(chunk as Buffer));
    tarPack.on("end", () => resolve(Buffer.concat(chunks)));
    tarPack.on("error", reject);
  });

  for (const { relPath, buf, mode } of files) {
    tarPack.entry({ name: `${prefix}/${relPath}`, size: buf.length, mtime: FIXED_MTIME, mode }, buf);
  }
  tarPack.finalize();

  const buffer = gzipSync(await collected);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return { buffer, sha256 };
}

/** `<owner>-<name>-<version>.tgz` — the `Content-Disposition` filename shared
 *  by the "latest" and versioned download routes. Pure so it's unit-testable
 *  without a Request/Response. */
export function tarballFilename(owner: string, name: string, version: string): string {
  return `${owner}-${name}-${version}.tgz`;
}

export type TarballCachePolicy = "immutable" | "short" | "private";

export interface TarballHeaderOptions {
  owner: string;
  name: string;
  version: string;
  sha256: string;
  contentLength: number;
  /**
   * - "immutable": versioned tarballs of a free package — a published version's
   *   files never change, so this is safe to cache for a year (G-V4).
   * - "short": the "latest" alias route's free case — its target *can* change
   *   as new versions are published, so it keeps the old, short-lived TTL.
   * - "private": any paid tarball — varies by requester (200 vs 402) and must
   *   never be cached or shared.
   */
  cache: TarballCachePolicy;
}

const CACHE_CONTROL: Record<TarballCachePolicy, string> = {
  immutable: "public, max-age=31536000, immutable",
  short: "public, max-age=300",
  private: "private, no-store",
};

/** Builds the header set shared by every tarball GET/HEAD response — pure so
 *  filename/cache/ETag behavior is unit-testable without a Request. */
export function tarballHeaders(opts: TarballHeaderOptions): HeadersInit {
  const filename = tarballFilename(opts.owner, opts.name, opts.version);
  return {
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(opts.contentLength),
    "Cache-Control": CACHE_CONTROL[opts.cache],
    ETag: `"${opts.sha256}"`,
    "X-Checksum-Sha256": opts.sha256,
  };
}

/** True when `ifNoneMatch` (a raw `If-None-Match` request header, possibly a
 *  comma-separated list or `*`) matches `sha256`'s quoted ETag — the condition
 *  under which a route should answer 304 instead of resending the tarball.
 *  Pure so it's unit-testable without a Request. Accepts a weak (`W/"..."`)
 *  match too, per RFC 7232 §2.3.2's weak-comparison rule for a plain GET. */
export function etagMatches(ifNoneMatch: string | null | undefined, sha256: string): boolean {
  if (!ifNoneMatch) return false;
  const tag = `"${sha256}"`;
  return ifNoneMatch
    .split(",")
    .map((t) => t.trim())
    .some((t) => t === "*" || t === tag || t === `W/${tag}`);
}
