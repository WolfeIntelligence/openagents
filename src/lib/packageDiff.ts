// Version-diff orchestration (Z3): loads two published versions of a package,
// resolves paywall access against the version being viewed (`to`), and builds
// a per-file diff between them. Shared by the JSON diff API route
// (`/api/v1/packages/[owner]/[name]/versions/[version]/diff`) and the compare
// page (`/p/[owner]/[name]/compare`) so the two can never disagree about what
// counts as added/removed/modified or how the paywall applies — factored out
// here (rather than duplicated in both, or exported from the route file,
// which Next.js route handlers don't support for arbitrary helpers) the same
// way `catalog/versions.ts` factors out version lookups.
//
// Safe to import with zero env vars: every dependency here (`catalog/versions`,
// `access`) already is.

import type { Session } from "next-auth";
import { getPackageVersion, getFileAtVersion } from "@/lib/catalog/versions";
import { resolveAccess } from "@/lib/access";
import { diffLines, type Hunk } from "@/lib/diff";

export interface FileDiffEntry {
  path: string;
  status: "added" | "removed" | "modified" | "unchanged";
  additions: number;
  deletions: number;
  /** Omitted for binary files and for unchanged files. */
  hunks?: Hunk[];
  /** Present (always `"base64"`) for a binary file — `hunks` is never set
   *  alongside this. */
  encoding?: "base64";
}

export interface VersionDiffResult {
  from: string;
  to: string;
  files: FileDiffEntry[];
  summary: { added: number; removed: number; modified: number };
  /** Set true when the 500KB hunk-text cap was hit — later files in `files`
   *  still report accurate status/additions/deletions, just without `hunks`. */
  truncated?: boolean;
}

export type VersionDiffOutcome =
  | { ok: true; result: VersionDiffResult }
  | { ok: false; status: 404; message: string }
  | { ok: false; status: 402; message: string };

// Contract: "capped at 500 KB of hunk text (then truncated: true)".
const MAX_HUNK_TEXT_BYTES = 500 * 1024;

function hunkTextBytes(hunks: Hunk[]): number {
  let total = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) total += line.text.length + 1; // +1 for the implied newline
  }
  return total;
}

/**
 * Builds the diff between `fromVersion` and `toVersion` of `owner/name`.
 * Access is resolved against `toVersion` (the version actually being viewed,
 * mirroring the per-version download route) — on a paid package, a viewer
 * who can't download it can't diff it either, and gets a 402 the same way
 * the download/file-viewer surfaces do, rather than a partial per-file lock.
 */
export async function buildVersionDiff(
  owner: string,
  name: string,
  toVersion: string,
  fromVersion: string,
  session: Session | null | undefined
): Promise<VersionDiffOutcome> {
  const [toPkg, fromPkg] = await Promise.all([
    getPackageVersion(owner, name, toVersion),
    getPackageVersion(owner, name, fromVersion),
  ]);
  if (!toPkg) return { ok: false, status: 404, message: `version not found: ${owner}/${name}@${toVersion}` };
  if (!fromPkg) return { ok: false, status: 404, message: `version not found: ${owner}/${name}@${fromVersion}` };

  const access = await resolveAccess(toPkg, session);
  if (!access.isFree && !access.canDownload) {
    return { ok: false, status: 402, message: "purchase required to diff this package" };
  }

  const pathSet = new Set<string>([...toPkg.files.map((f) => f.path), ...fromPkg.files.map((f) => f.path)]);
  const paths = Array.from(pathSet).sort();

  const files: FileDiffEntry[] = [];
  const summary = { added: 0, removed: 0, modified: 0 };
  let usedHunkBytes = 0;
  let truncated = false;

  for (const path of paths) {
    const inTo = toPkg.files.find((f) => f.path === path);
    const inFrom = fromPkg.files.find((f) => f.path === path);

    const [toFile, fromFile] = await Promise.all([
      inTo ? getFileAtVersion(owner, name, toVersion, path) : Promise.resolve(null),
      inFrom ? getFileAtVersion(owner, name, fromVersion, path) : Promise.resolve(null),
    ]);

    const isBinary = toFile?.encoding === "base64" || fromFile?.encoding === "base64";

    if (isBinary) {
      const toContent = toFile?.content;
      const fromContent = fromFile?.content;
      const status: FileDiffEntry["status"] = !inFrom
        ? "added"
        : !inTo
          ? "removed"
          : toContent === fromContent
            ? "unchanged"
            : "modified";
      if (status === "unchanged") {
        files.push({ path, status, additions: 0, deletions: 0 });
      } else {
        files.push({ path, status, additions: 0, deletions: 0, encoding: "base64" });
        if (status === "modified") summary.modified++;
        else if (status === "added") summary.added++;
        else summary.removed++;
      }
      continue;
    }

    const oldText = inFrom ? (fromFile?.content ?? "") : "";
    const newText = inTo ? (toFile?.content ?? "") : "";

    if (inFrom && inTo && oldText === newText) {
      files.push({ path, status: "unchanged", additions: 0, deletions: 0 });
      continue;
    }

    const diffResult = diffLines(oldText, newText);
    const status: FileDiffEntry["status"] = !inFrom ? "added" : !inTo ? "removed" : "modified";
    if (status === "added") summary.added++;
    else if (status === "removed") summary.removed++;
    else summary.modified++;

    const bytes = hunkTextBytes(diffResult.hunks);
    if (usedHunkBytes + bytes > MAX_HUNK_TEXT_BYTES) {
      truncated = true;
      files.push({ path, status, additions: diffResult.additions, deletions: diffResult.deletions });
    } else {
      usedHunkBytes += bytes;
      files.push({
        path,
        status,
        additions: diffResult.additions,
        deletions: diffResult.deletions,
        hunks: diffResult.hunks,
      });
    }
  }

  return {
    ok: true,
    result: { from: fromVersion, to: toVersion, files, summary, ...(truncated ? { truncated: true } : {}) },
  };
}
