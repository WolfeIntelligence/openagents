// Turns a package directory into the in-memory payload `openagents publish`
// POSTs to `/api/v1/publish`: { manifest, files: [{path, content, encoding?,
// mode?}], changelog? }.
//
// Reuses the exact same validation `openagents validate` runs (via
// `validatePackageDir`) so a package that passes `validate` never fails
// `publish` for a reason `validate` didn't already report — then reads every
// file as bytes and enforces the registry's size/count limits client-side, so
// a bad publish fails locally instead of after an upload.
//
// Binary files (anything `isProbablyBinary` flags) are sent as base64 with
// `encoding: "base64"`, mirroring src/lib/files.ts on the registry side —
// duplicated here rather than imported since the CLI is a separate
// zero-dependency package that can't reach into src/.

import fs from "node:fs";
import path from "node:path";
import { validatePackageDir } from "./commands/validate.js";

// Mirrors the registry contract: <=200 files, <=512KB each (text), <=2MB total.
export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
// A single binary file's decoded-size ceiling — larger than MAX_FILE_BYTES
// since one image/asset can reasonably exceed the flat text limit, as long
// as the whole upload still fits under MAX_TOTAL_BYTES. Mirrors
// MAX_BINARY_BYTES in src/lib/files.ts.
export const MAX_BINARY_BYTES = 2 * 1024 * 1024;

const SNIFF_BYTES = 8192;

/** Mirrors `isProbablyBinary` in src/lib/files.ts: a NUL byte in the first
 *  8KB, or content that isn't valid UTF-8 anywhere in the buffer. */
function isProbablyBinary(buf) {
  const head = buf.subarray(0, SNIFF_BYTES);
  if (head.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return false;
  } catch {
    return true;
  }
}

/** Mirrors `isExecutableName` in src/lib/files.ts: a `.sh` file anywhere, or
 *  an extensionless file under a `bin/` or `scripts/` directory. Used as the
 *  mode fallback wherever a real POSIX execute bit isn't available (i.e. on
 *  Windows — see `fileMode` below). */
function isExecutableName(relPath) {
  const posix = relPath.split(path.sep).join("/");
  const base = posix.slice(posix.lastIndexOf("/") + 1);
  if (/\.sh$/i.test(base)) return true;
  if (base.includes(".")) return false;
  const dirSegments = posix.slice(0, posix.length - base.length).split("/").filter(Boolean);
  return dirSegments.includes("bin") || dirSegments.includes("scripts");
}

/** POSIX file mode to send for `relPath`: 0o755 when the real execute bit is
 *  set on `stat.mode` (POSIX only — Node reports a fixed, meaningless mode
 *  for every file on Windows), falling back to the name-based
 *  `isExecutableName` heuristic; `undefined` (the registry's default 0o644)
 *  otherwise. */
function fileMode(relPath, stat) {
  const posixExecutable = process.platform !== "win32" && (stat.mode & 0o111) !== 0;
  if (posixExecutable) return 0o755;
  return isExecutableName(relPath) ? 0o755 : undefined;
}

export class PackError extends Error {
  constructor(message, issues) {
    super(message);
    this.name = "PackError";
    this.issues = issues && issues.length ? issues : [message];
  }
}

/**
 * Validate and read the package in `dir` into a publish payload. Throws
 * `PackError` (with `.issues`, always non-empty) on any failure: an invalid
 * manifest, a file listed in the manifest that's missing on disk, or a file
 * exceeding `MAX_FILES` / `MAX_FILE_BYTES` (text) / `MAX_BINARY_BYTES`
 * (binary) / `MAX_TOTAL_BYTES`. Binary files (detected via `isProbablyBinary`)
 * are base64-encoded with `encoding: "base64"` rather than rejected.
 */
export function packDirectory(dir) {
  const { manifest, issues } = validatePackageDir(dir);
  if (issues.length > 0) {
    throw new PackError(`${issues.length} issue${issues.length === 1 ? "" : "s"} found in openagent.yaml`, issues);
  }

  // Always upload the manifest and README, plus everything openagent.yaml
  // lists (which already includes `entry`, per validateManifest).
  const relPaths = [...new Set(["openagent.yaml", "README.md", ...manifest.files])];

  if (relPaths.length > MAX_FILES) {
    throw new PackError(`too many files: ${relPaths.length} (max ${MAX_FILES})`);
  }

  const files = [];
  const packIssues = [];
  let totalBytes = 0;

  for (const relPath of relPaths) {
    const fullPath = path.join(dir, relPath);
    let buf;
    let stat;
    try {
      buf = fs.readFileSync(fullPath);
      stat = fs.statSync(fullPath);
    } catch (err) {
      packIssues.push(`${relPath}: could not read file: ${err.message}`);
      continue;
    }

    const binary = isProbablyBinary(buf);
    const cap = binary ? MAX_BINARY_BYTES : MAX_FILE_BYTES;
    if (buf.length > cap) {
      packIssues.push(`${relPath}: file too large (${formatSize(buf.length)}, max ${formatSize(cap)})`);
      continue;
    }
    totalBytes += buf.length;

    const mode = fileMode(relPath, stat);
    const file = { path: relPath, content: binary ? buf.toString("base64") : buf.toString("utf8") };
    if (binary) file.encoding = "base64";
    if (mode !== undefined) file.mode = mode;
    files.push(file);
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    packIssues.push(`package too large: ${formatSize(totalBytes)} total (max ${formatSize(MAX_TOTAL_BYTES)})`);
  }

  if (packIssues.length > 0) {
    throw new PackError(`${packIssues.length} issue${packIssues.length === 1 ? "" : "s"} packing ${dir}`, packIssues);
  }

  const result = { manifest, files };

  const changelogPath = path.join(dir, "CHANGELOG.md");
  if (fs.existsSync(changelogPath)) {
    try {
      const raw = fs.readFileSync(changelogPath, "utf8");
      const section = firstChangelogSection(raw);
      if (section) result.changelog = section;
    } catch {
      // An unreadable CHANGELOG.md isn't fatal — publish can proceed
      // without a changelog note.
    }
  }

  return result;
}

/**
 * The body of the first `#`/`##` heading in a CHANGELOG.md, trimmed — e.g.
 * for "## 1.2.0\n\n- fixed X\n\n## 1.1.0\n...", returns "- fixed X". Falls
 * back to the whole trimmed text when there's no heading at all, and to
 * `undefined` when there's nothing there.
 */
export function firstChangelogSection(text) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,2}\s+\S/.test(lines[i])) {
      if (start === -1) {
        start = i + 1;
      } else {
        end = i;
        break;
      }
    }
  }
  if (start === -1) {
    const trimmed = text.trim();
    return trimmed || undefined;
  }
  const section = lines.slice(start, end).join("\n").trim();
  return section || undefined;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
  }
  return `${Math.round(bytes / 1024)}KB`;
}
