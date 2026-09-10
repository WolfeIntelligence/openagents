// Minimal install lockfile: <projectDir>/.openagents/installed.json
//
// { "packages": { "owner/name": { version, kind, runtime, path, installedAt, registry } } }
//
// `path` is stored relative to the project directory. This is intentionally
// small (G-V3's "minimal" scope): no integrity hashes, no dependency graph.

import fs from "node:fs";
import path from "node:path";

export function lockfilePath(projectDir) {
  return path.join(projectDir, ".openagents", "installed.json");
}

/** Read the lockfile for `projectDir`, or `{ packages: {} }` if it does not exist / is unreadable. */
export function readLockfile(projectDir) {
  const p = lockfilePath(projectDir);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && data.packages && typeof data.packages === "object") {
      return data;
    }
  } catch {
    // missing, unreadable, or malformed — treat as empty
  }
  return { packages: {} };
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

export function writeLockfile(projectDir, data) {
  const p = lockfilePath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}
