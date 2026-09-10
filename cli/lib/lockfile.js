// Install lockfile: <projectDir>/.openagents/installed.json
//
// { "lockfileVersion": 2, "packages": { "owner/name": {
//     version, kind, runtime, path, installedAt, registry,
//     integrity, requestedRange
// } } }
//
// `path` is stored relative to the project directory. `integrity` is a
// `"sha256-<hex>"` string for the installed tarball (X6a / G-V4);
// `requestedRange` is the `@range`/`@version` selector the install was made
// with (undefined when the plain "latest" ref was used) so `outdated`/
// `update` know what "wanted" means. Both are optional for backward
// compatibility with v1 entries, which had neither field — v1 lockfiles
// (no top-level `lockfileVersion`) are read the same way, just with those
// fields undefined per entry; nothing is renamed, only added.

import fs from "node:fs";
import path from "node:path";

export const LOCKFILE_VERSION = 2;

export function lockfilePath(projectDir) {
  return path.join(projectDir, ".openagents", "installed.json");
}

/**
 * Read the lockfile for `projectDir`, or `{ lockfileVersion, packages: {} }`
 * if it does not exist / is unreadable. A v1 file (no `lockfileVersion`
 * field) reads back with `lockfileVersion: 1` and its entries untouched —
 * per-entry fields are additive across versions, so callers can read v1 and
 * v2 entries the same way.
 */
export function readLockfile(projectDir) {
  const p = lockfilePath(projectDir);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && data.packages && typeof data.packages === "object") {
      const lockfileVersion = typeof data.lockfileVersion === "number" ? data.lockfileVersion : 1;
      return { lockfileVersion, packages: data.packages };
    }
  } catch {
    // missing, unreadable, or malformed — treat as empty
  }
  return { lockfileVersion: LOCKFILE_VERSION, packages: {} };
}

/** Merge `entry` into the lockfile under `owner/name` and write it back. */
export function recordInstall(projectDir, ownerSlashName, entry) {
  const data = readLockfile(projectDir);
  data.packages[ownerSlashName] = { ...data.packages[ownerSlashName], ...entry };
  writeLockfile(projectDir, data);
  return data;
}

/** Remove `owner/name` from the lockfile (no-op if absent) and write it back. */
export function removeInstall(projectDir, ownerSlashName) {
  const data = readLockfile(projectDir);
  delete data.packages[ownerSlashName];
  writeLockfile(projectDir, data);
  return data;
}

/** Write the lockfile, always stamping the current `lockfileVersion` (upgrading a v1 file on next write). */
export function writeLockfile(projectDir, data) {
  const p = lockfilePath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = { lockfileVersion: LOCKFILE_VERSION, packages: (data && data.packages) || {} };
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + "\n", "utf8");
}
