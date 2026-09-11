// Binary-file support (Y3, audit gap: "binary files and executable scripts:
// the tarball is text-only and drops file modes"). Shared helpers used by
// publish.ts, github-import.ts, tarball.ts, the catalog layers, and the raw
// file/viewer routes so all of them agree on what counts as binary, what
// content-type a path gets served as, which files are "executable" by name,
// and how a `PackageFile`'s `content` decodes to real bytes.

import type { PackageFile } from "@/lib/types";

/** How many leading bytes of a file we sniff for a NUL byte before falling
 *  back to a full UTF-8 validity check (see `isProbablyBinary`). Matches the
 *  size `git` itself uses for its own binary heuristic — enough to catch
 *  binary formats that pad a header, cheap enough to run on every upload. */
const SNIFF_BYTES = 8192;

/**
 * Upper bound on a single binary file's *decoded* size. Distinct from
 * publish.ts's `MAX_FILE_BYTES` (512 KB), which still applies to text: an
 * image or other asset can reasonably be larger than that, as long as the
 * whole upload still fits under the registry's 2 MB total (see
 * `MAX_TOTAL_BYTES` in publish.ts, which this intentionally matches).
 */
export const MAX_BINARY_BYTES = 2 * 1024 * 1024;

/**
 * True when `buffer` looks like binary content rather than text: a NUL byte
 * in the first `SNIFF_BYTES`, or content that isn't valid UTF-8 anywhere in
 * the buffer. Either signal alone is enough — legitimate UTF-8 text never
 * contains a NUL byte, and non-UTF-8 bytes never appear in it either.
 */
export function isProbablyBinary(buffer: Buffer): boolean {
  const head = buffer.subarray(0, SNIFF_BYTES);
  if (head.includes(0)) return true;
  try {
    // `fatal: true` throws on any invalid byte sequence instead of silently
    // replacing it with U+FFFD, which is what makes this a real validity
    // check rather than a no-op.
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return false;
  } catch {
    return true;
  }
}

/** Extension -> MIME type, for both the raw file route and the file viewer's
 *  binary-panel/image decision. Anything not listed here is treated as an
 *  opaque download (`application/octet-stream`), which is also the correct
 *  answer for an unrecognized binary format. */
const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  txt: "text/plain",
  js: "text/plain",
  ts: "text/plain",
  py: "text/plain",
  sh: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  pdf: "application/pdf",
  zip: "application/zip",
  tgz: "application/gzip",
  gz: "application/gzip",
  wasm: "application/wasm",
};

/** Content-Type for `filePath`, looked up by extension (case-insensitive).
 *  Defaults to `application/octet-stream` for anything unrecognized. */
export function contentTypeFor(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** True for a Content-Type this module considers an image — the one case the
 *  file viewer and raw-file route render/serve inline instead of forcing a
 *  download. */
export function isImageContentType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

/**
 * Name-based executable heuristic, used wherever a real POSIX mode bit isn't
 * available or isn't trustworthy (Windows; the seed catalog reading files
 * straight off disk; a GitHub import entry with no meaningful tar mode).
 * True for a `.sh` file anywhere, or an extensionless file under a `bin/` or
 * `scripts/` directory (any depth) — the two shapes a package's own scripts
 * actually take in practice.
 */
export function isExecutableName(filePath: string): boolean {
  const posix = filePath.split("\\").join("/");
  const base = posix.slice(posix.lastIndexOf("/") + 1);
  if (/\.sh$/i.test(base)) return true;
  if (base.includes(".")) return false; // any other extension: not a script we guess at
  const dirSegments = posix.slice(0, posix.length - base.length).split("/").filter(Boolean);
  return dirSegments.includes("bin") || dirSegments.includes("scripts");
}

/**
 * Decodes a `PackageFile`'s `content` to real bytes: base64 when
 * `file.encoding === "base64"`, UTF-8 text otherwise (the default, including
 * when `encoding` is absent — every file predates this field). Returns an
 * empty buffer for a file with no `content` (e.g. a listing entry that never
 * fetched it) rather than throwing, since callers already guard on
 * `content !== undefined` before deciding whether to use this at all.
 */
export function decodeContent(file: Pick<PackageFile, "content" | "encoding">): Buffer {
  if (file.content === undefined) return Buffer.alloc(0);
  return file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
}
