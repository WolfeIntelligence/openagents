// Turns a package directory into the in-memory payload `openagents publish`
// POSTs to `/api/v1/publish`: { manifest, files: [{path, content}], changelog? }.
//
// Reuses the exact same validation `openagents validate` runs (via
// `validatePackageDir`) so a package that passes `validate` never fails
// `publish` for a reason `validate` didn't already report — then reads every
// file UTF-8 and enforces the registry's size/count limits client-side, so a
// bad publish fails locally instead of after an upload.

import fs from "node:fs";
import path from "node:path";
import { validatePackageDir } from "./commands/validate.js";

// Mirrors the registry contract: <=200 files, <=512KB each, <=2MB total.
export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

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
 * manifest, a file listed in the manifest that's missing on disk, a binary
 * file (content containing a NUL byte — publish accepts UTF-8 text only),
 * or exceeding `MAX_FILES` / `MAX_FILE_BYTES` / `MAX_TOTAL_BYTES`.
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
    try {
      buf = fs.readFileSync(fullPath);
    } catch (err) {
      packIssues.push(`${relPath}: could not read file: ${err.message}`);
      continue;
    }
    if (buf.includes(0)) {
      packIssues.push(`${relPath}: binary files are not supported (publish accepts UTF-8 text only)`);
      continue;
    }
    if (buf.length > MAX_FILE_BYTES) {
      packIssues.push(`${relPath}: file too large (${formatSize(buf.length)}, max ${formatSize(MAX_FILE_BYTES)})`);
      continue;
    }
    totalBytes += buf.length;
    files.push({ path: relPath, content: buf.toString("utf8") });
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
