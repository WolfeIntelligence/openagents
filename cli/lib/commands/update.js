// `openagents update [owner/name...] [--dir] [--latest]` (X6a): reinstall
// lockfile entries to the newest version satisfying their recorded
// `requestedRange` (or the absolute latest with `--latest`), regenerating
// shims and updating the lockfile. No-op message when everything is already
// up to date.

import path from "node:path";
import * as util from "../util.js";
import { readLockfile } from "../lockfile.js";
import { maxSatisfying } from "../semver.js";
import { installPackage } from "./add.js";

async function resolveTarget({ id, entry, base, useLatest, runtime }) {
  if (useLatest || !entry.requestedRange) {
    const detail = await util.fetchJson(base, { runtime });
    const manifest = detail.manifest || detail;
    return {
      version: manifest.version,
      manifest,
      downloadUrl: detail.downloadUrl || `${base}/download`,
      status: detail.status,
      deprecation: detail.deprecation,
    };
  }

  const versionsRes = await util.fetchJson(`${base}/versions`, { runtime });
  const versions = (versionsRes.versions || []).map((v) => v.version);
  const picked = maxSatisfying(versions, entry.requestedRange);
  if (!picked) {
    throw new Error(`no published version of ${id} satisfies its recorded range "${entry.requestedRange}"`);
  }
  if (picked === entry.version) {
    // Already at the newest version satisfying the range — no need to fetch
    // full version details just to discover that.
    return { version: picked, manifest: null, downloadUrl: null, status: undefined, deprecation: undefined };
  }
  const detail = await util.fetchJson(`${base}/versions/${picked}`, { runtime });
  const manifest = detail.manifest || detail;
  return {
    version: manifest.version || picked,
    manifest,
    downloadUrl: detail.downloadUrl || `${base}/versions/${picked}/download`,
    status: detail.status,
    deprecation: detail.deprecation,
  };
}

/**
 * `installFn` is injectable for tests (it defaults to the real
 * download/extract/shim/lockfile-record pipeline in `add.js`, which needs
 * the `tar` package at runtime).
 */
export async function run(args, { installFn = installPackage } = {}) {
  const projectDir = path.resolve(args.dir || ".");
  const { packages } = readLockfile(projectDir);
  const allIds = Object.keys(packages);

  if (allIds.length === 0 && args._.length === 0) {
    console.log("No packages installed (no .openagents/installed.json in this directory).");
    return;
  }

  const requested = args._.length ? args._ : allIds;
  const registry = util.registryUrl(args.registry);
  const useLatest = Boolean(args.latest);

  let anyUpdated = false;
  let hadError = false;

  for (const id of requested) {
    const entry = packages[id];
    if (!entry) {
      console.error(`✗ ${id} is not installed (see "openagents list")`);
      hadError = true;
      continue;
    }

    const [owner, name] = id.split("/");
    const base = `${registry}/api/v1/packages/${owner}/${name}`;

    let target;
    try {
      target = await resolveTarget({ id, entry, base, useLatest, runtime: entry.runtime });
    } catch (err) {
      console.error(`✗ could not check ${id}: ${err.message}`);
      hadError = true;
      continue;
    }

    if (target.status === "pending") {
      console.error(`✗ ${id}@${target.version} is pending review and cannot be installed yet`);
      hadError = true;
      continue;
    }
    if (target.status === "deprecated") {
      const msg = target.deprecation?.message ? ` — ${target.deprecation.message}` : "";
      const repl = target.deprecation?.replacementId ? ` (see ${target.deprecation.replacementId})` : "";
      console.warn(`⚠ ${id}@${target.version} is deprecated${msg}${repl}`);
    }

    if (target.version === entry.version) {
      console.log(`${id} is already up to date at ${entry.version}`);
      continue;
    }

    console.log(`Updating ${id} ${entry.version} → ${target.version} ...`);
    const ok = await installFn({
      owner,
      name,
      version: target.version,
      manifest: target.manifest,
      downloadUrl: target.downloadUrl,
      registry,
      runtime: entry.runtime,
      projectDir,
      requestedRange: entry.requestedRange,
    });
    if (ok) {
      anyUpdated = true;
    } else {
      hadError = true;
    }
  }

  if (!anyUpdated && !hadError) {
    console.log("Everything is already up to date.");
  }
  if (hadError) {
    process.exitCode = 1;
  }
}
