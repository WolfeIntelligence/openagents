import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as util from "../util.js";
import { installDir, detectRuntime, RUNTIME_IDS } from "../runtimes.js";
import { buildShims, nextStepHint } from "../shims.js";
import { readLockfile, recordInstall } from "../lockfile.js";
import { buildPlan, formatPlan } from "../resolve.js";
import { sha256Hex, toIntegrityString, parseIntegrityString, expectedChecksumFromHeaders, verifyChecksum } from "../integrity.js";
import { satisfies, tryParseRange } from "../semver.js";

/**
 * Whether advisory `range` (its `affectedVersions`, e.g. "<1.3.0") covers
 * `version`. A missing/empty range affects every version; an unparsable one
 * (most likely a typo when it was posted) fails open — shown/enforced rather
 * than silently skipped — mirroring `affectsVersion` in
 * src/lib/advisories.ts server-side.
 */
function advisoryAffects(version, range) {
  if (!range || !String(range).trim()) return true;
  if (!tryParseRange(range)) return true;
  return satisfies(version, range);
}

/**
 * `installFn` is injectable (default: the real `installPackage` below,
 * defined in this same module — see update.js for the same pattern) so tests
 * can exercise the advisory-check/refusal logic above without a real
 * download+extract pipeline.
 */
export async function run(args, { installFn = installPackage } = {}) {
  const ref = args._[0];
  if (!ref) {
    console.error("✗ usage: openagents add <owner/name[@version|@range]> [--runtime <id>] [--registry <url>] [--dir <path>] [--no-deps] [--force]");
    process.exitCode = 1;
    return;
  }

  let owner, name, version;
  try {
    ({ owner, name, version } = util.splitPackageRef(ref));
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const registry = util.registryUrl(args.registry);
  const projectDir = path.resolve(args.dir || ".");

  let runtime = args.runtime;
  if (runtime && !RUNTIME_IDS.includes(runtime)) {
    console.error(`✗ --runtime must be one of ${RUNTIME_IDS.join(", ")}, got: ${runtime}`);
    process.exitCode = 1;
    return;
  }
  if (!runtime) {
    runtime = detectRuntime(projectDir, util.existsSync);
  }

  const noDeps = Boolean(args["no-deps"] ?? args.noDeps);

  let plan;
  try {
    plan = await buildPlan({ owner, name, range: version, registry, runtime, projectDir, noDeps });
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nResolved ${plan.length} package${plan.length === 1 ? "" : "s"} to install:`);
  console.log(formatPlan(plan));
  console.log("");

  // Z2: security advisories for the package the user explicitly asked to add
  // (`plan[0]` is always the root — see buildPlan's doc comment in resolve.js).
  // Fetched separately from the manifest/plan above since advisories aren't
  // part of resolve.js's registry contract; this only covers the root, not
  // transitive dependencies pulled in via `manifest.requires`.
  const root = plan[0];
  const force = Boolean(args.force);
  let advisories = [];
  try {
    const res = await util.fetchJson(`${registry}/api/v1/packages/${owner}/${name}/advisories`, { runtime });
    advisories = Array.isArray(res.items) ? res.items : [];
  } catch (err) {
    console.error(`⚠ could not check advisories for ${owner}/${name}: ${err.message}`);
  }

  const activeForVersion = advisories.filter(
    (a) => !a.withdrawnAt && advisoryAffects(root.version, a.affectedVersions)
  );
  if (activeForVersion.length > 0) {
    console.log(`Security advisories for ${owner}/${name}@${root.version}:`);
    for (const a of activeForVersion) {
      const fixed = a.fixedInVersion ? ` (fixed in v${a.fixedInVersion})` : "";
      console.log(`  [${a.severity}] ${a.title}${fixed}`);
    }
    console.log("");
  }

  const critical = activeForVersion.filter((a) => a.severity === "critical");
  if (critical.length > 0 && !force) {
    console.error(
      `✗ refusing to install ${owner}/${name}@${root.version}: ${critical.length} critical advisor${critical.length === 1 ? "y" : "ies"} affect${critical.length === 1 ? "s" : ""} this version. Re-run with --force to install anyway.`
    );
    process.exitCode = 1;
    return;
  }

  for (const entry of plan) {
    if (entry.cached) continue;
    const [pOwner, pName] = entry.id.split("/");
    const ok = await installFn({
      owner: pOwner,
      name: pName,
      version: entry.version,
      manifest: entry.manifest,
      downloadUrl: entry.downloadUrl,
      registry,
      runtime,
      projectDir,
      requestedRange: entry.requestedRange,
    });
    if (!ok) {
      process.exitCode = 1;
      return;
    }
  }
}

/**
 * Download, verify, extract, shim, and record a single resolved package.
 * Shared by `add` (for the root package and every resolved dependency) and
 * `update`. Returns `true` on success, `false` on a handled failure
 * (already reported to the console).
 *
 * `extract(buf, tmpDir)` is injectable for tests that can't rely on the
 * `tar` package being installed; it defaults to real tarball extraction.
 */
export async function installPackage({ owner, name, version, manifest, downloadUrl, registry, runtime, projectDir, requestedRange, extract = defaultExtract }) {
  const id = `${owner}/${name}`;
  const destRelative = installDir(runtime, name);
  const destDir = path.join(projectDir, destRelative);
  const destRelativeSlash = destRelative.split(path.sep).join("/");

  const lock = readLockfile(projectDir);
  const prior = lock.packages[id];
  if (prior) {
    if (prior.version && prior.version !== version) {
      console.log(`updating ${id} ${prior.version} → ${version}`);
    } else {
      console.log(`already at ${version}, reinstalling ${id}`);
    }
  }

  const url = downloadUrl || `${registry}/api/v1/packages/${owner}/${name}/download`;
  console.log(`Downloading ${id}@${version || "?"} ...`);

  // Built defensively so this works whether or not `util.js` has picked up
  // `userAgentHeaders`/`authHeaders` yet (another workstream is adding
  // `authHeaders` there for paid-package downloads).
  const uaHeaders = typeof util.userAgentHeaders === "function" ? util.userAgentHeaders(runtime) : { "User-Agent": util.userAgent(runtime) };
  const headers = { ...uaHeaders, ...(typeof util.authHeaders === "function" ? util.authHeaders(registry) : {}) };

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    console.error(`✗ could not download ${id}: ${err.message}`);
    return false;
  }
  if (!res.ok || !res.body) {
    if (res.status === 402) {
      const price = util.formatPrice(manifest?.pricing?.amountCents, manifest?.pricing?.currency);
      const hasToken = Boolean(util.authHeaders(registry).Authorization);
      console.error(
        hasToken
          ? `✗ ${id} is a paid package (${price}) and your token has not purchased it. Buy it at ${registry}/p/${owner}/${name}, then retry.`
          : `✗ ${id} is a paid package (${price}). Buy it at ${registry}/p/${owner}/${name}, then run \`openagents login\` and retry.`
      );
    } else {
      const err = await util.responseError(url, res, "GET");
      console.error(`✗ download failed for ${id}: ${err.message}`);
    }
    return false;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const actualHex = sha256Hex(buf);
  const expectedHex = expectedChecksumFromHeaders(res.headers);
  try {
    verifyChecksum(actualHex, expectedHex, { label: `${id}@${version}` });
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return false;
  }

  if (prior && prior.version === version && prior.integrity) {
    const priorHex = parseIntegrityString(prior.integrity);
    if (priorHex && priorHex !== actualHex) {
      console.error(
        `✗ integrity mismatch for ${id}@${version}: previously recorded ${prior.integrity}, freshly downloaded sha256-${actualHex}. ` +
          `The registry may have changed this version's contents; refusing to reinstall.`
      );
      return false;
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openagents-"));
  try {
    await extract(buf, tmpDir);

    // Some registries wrap package files in a single top-level directory
    // (e.g. "<name>/openagent.yaml"); flatten that if present so the install
    // dir always contains the package files directly.
    let sourceDir = tmpDir;
    const topLevel = fs.readdirSync(tmpDir, { withFileTypes: true });
    if (topLevel.length === 1 && topLevel[0].isDirectory()) {
      sourceDir = path.join(tmpDir, topLevel[0].name);
    }

    fs.mkdirSync(destDir, { recursive: true });
    copyDirRecursive(sourceDir, destDir);
  } catch (err) {
    console.error(`✗ could not extract ${id}: ${err.message}`);
    return false;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const shimManifest = { ...manifest, owner, name };
  const shimNote = applyRuntimeShims({ manifest: shimManifest, runtime, destDir, projectDir });

  console.log(`\n✓ installed ${id}@${version || "?"} for runtime "${runtime}"`);
  console.log(`  location: ${path.relative(process.cwd(), destDir) || "."}`);
  if (manifest?.entry) {
    console.log(`  entry:    ${path.relative(process.cwd(), path.join(destDir, manifest.entry)).split(path.sep).join("/")}`);
  }
  if (shimNote) {
    console.log(`  note:     ${shimNote}`);
  }
  console.log(`  ${nextStepHint(shimManifest, runtime, destRelativeSlash)}`);

  recordInstall(projectDir, id, {
    version,
    kind: manifest?.kind,
    runtime,
    path: destRelativeSlash,
    installedAt: new Date().toISOString(),
    registry,
    integrity: toIntegrityString(actualHex),
    requestedRange: requestedRange || undefined,
  });
  return true;
}

async function defaultExtract(buf, tmpDir) {
  const tar = await import("tar");
  // `tar.x` preserves each entry's mode bit-for-bit on POSIX (Y3: the
  // registry's tarballs now carry real modes — see src/lib/tarball.ts). On
  // Windows, NTFS has no concept of a Unix executable bit, so `tar` silently
  // drops it during extraction: the files land fine, but a package's bin/
  // scripts need to be run explicitly (e.g. `sh script`) rather than
  // executed directly. `copyDirRecursive` below re-applies whatever mode did
  // make it through the extraction, so this limitation is Windows-only and
  // not compounded by the flatten-copy step that follows.
  await pipeline(Readable.from(buf), tar.x({ cwd: tmpDir }));
}

/**
 * Write whatever runtime discovery shim(s) `runtime` needs (SKILL.md for
 * claude-code/codex, .cursor/rules/<name>.mdc for cursor; none otherwise).
 * Returns a note string to surface to the user (e.g. "left an existing
 * user-edited shim alone"), or null.
 */
function applyRuntimeShims({ manifest, runtime, destDir, projectDir }) {
  if (runtime !== "claude-code" && runtime !== "codex" && runtime !== "cursor") {
    return null;
  }

  const opts = {};
  if (manifest.entry === "SKILL.md") {
    const entryPath = path.join(destDir, "SKILL.md");
    if (util.existsSync(entryPath)) {
      opts.entryContent = fs.readFileSync(entryPath, "utf8");
    }
  } else if (runtime === "claude-code" || runtime === "codex") {
    const skillPath = path.join(destDir, "SKILL.md");
    if (util.existsSync(skillPath)) {
      opts.existingShimContent = fs.readFileSync(skillPath, "utf8");
    }
  } else if (runtime === "cursor") {
    const mdcPath = path.join(projectDir, ".cursor", "rules", `${manifest.name}.mdc`);
    if (util.existsSync(mdcPath)) {
      opts.existingShimContent = fs.readFileSync(mdcPath, "utf8");
    }
  }

  const { files, note } = buildShims(manifest, runtime, opts);
  for (const file of files) {
    const root = runtime === "cursor" ? projectDir : destDir;
    const target = path.join(root, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, "utf8");
  }
  return note;
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      // fs.copyFileSync does NOT carry over the source file's mode — the new
      // file gets the default creation mode under the process umask — so
      // without this, `tar.x`'s mode preservation above would be silently
      // undone by this flatten-copy step for every install. Best-effort: an
      // unreadable/unsettable mode isn't fatal to the install itself.
      try {
        fs.chmodSync(d, fs.statSync(s).mode);
      } catch {
        // ignore
      }
    }
  }
}
