import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import {
  registryUrl,
  splitPackageRef,
  fetchJson,
  existsSync,
  responseError,
  formatPrice,
  userAgent,
} from "../util.js";
import { installDir, detectRuntime, RUNTIME_IDS } from "../runtimes.js";
import { buildShims, nextStepHint } from "../shims.js";
import { readLockfile, recordInstall } from "../lockfile.js";

export async function run(args) {
  const ref = args._[0];
  if (!ref) {
    console.error("✗ usage: openagents add <owner/name[@version]> [--runtime <id>] [--registry <url>] [--dir <path>]");
    process.exitCode = 1;
    return;
  }

  let owner, name, version;
  try {
    ({ owner, name, version } = splitPackageRef(ref));
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const registry = registryUrl(args.registry);
  const projectDir = path.resolve(args.dir || ".");

  let runtime = args.runtime;
  if (runtime && !RUNTIME_IDS.includes(runtime)) {
    console.error(`✗ --runtime must be one of ${RUNTIME_IDS.join(", ")}, got: ${runtime}`);
    process.exitCode = 1;
    return;
  }
  if (!runtime) {
    runtime = detectRuntime(projectDir, existsSync);
  }

  console.log(`Fetching ${owner}/${name} from ${registry} ...`);
  let pkg;
  try {
    pkg = await fetchJson(`${registry}/api/v1/packages/${owner}/${name}`, { runtime });
  } catch (err) {
    console.error(`✗ could not fetch package manifest: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const manifest = pkg.manifest || pkg;

  // @version selectors (G6): the registry has no versioned download yet, so
  // pinning to anything but the current latest is a hard error for `add`.
  if (version && version !== manifest.version) {
    console.error(`✗ version pinning isn't supported by this registry yet; latest is ${manifest.version}`);
    process.exitCode = 1;
    return;
  }

  const destRelative = installDir(runtime, name);
  const destDir = path.join(projectDir, destRelative);
  const destRelativeSlash = destRelative.split(path.sep).join("/");

  const lock = readLockfile(projectDir);
  const prior = lock.packages[`${owner}/${name}`];
  if (prior) {
    if (prior.version && prior.version !== manifest.version) {
      console.log(`updating ${owner}/${name} ${prior.version} → ${manifest.version}`);
    } else {
      console.log(`already at ${manifest.version}, reinstalling ${owner}/${name}`);
    }
  }

  const downloadUrl = new URL(pkg.downloadUrl || `${registry}/api/v1/packages/${owner}/${name}/download`);
  downloadUrl.searchParams.set("runtime", runtime);

  console.log(`Downloading ${owner}/${name}@${manifest.version || "?"} ...`);
  let res;
  try {
    res = await fetch(downloadUrl, { headers: { "User-Agent": userAgent(runtime) } });
  } catch (err) {
    console.error(`✗ could not download package: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!res.ok || !res.body) {
    if (res.status === 402) {
      const price = formatPrice(manifest.pricing?.amountCents, manifest.pricing?.currency);
      console.error(
        `✗ ${owner}/${name} is a paid package (${price}). Buy it at ${registry}/p/${owner}/${name} — installing purchased packages from the CLI requires signing in, which isn't available yet.`
      );
    } else {
      const err = await responseError(downloadUrl.toString(), res, "GET");
      console.error(`✗ download failed: ${err.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openagents-"));
  try {
    await pipeline(Readable.fromWeb(res.body), tar.x({ cwd: tmpDir }));

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
    console.error(`✗ could not extract package: ${err.message}`);
    process.exitCode = 1;
    return;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const shimManifest = { ...manifest, owner, name };
  const shimNote = applyRuntimeShims({ manifest: shimManifest, runtime, destDir, projectDir });

  console.log(`\n✓ installed ${owner}/${name}@${manifest.version || "?"} for runtime "${runtime}"`);
  console.log(`  location: ${path.relative(process.cwd(), destDir) || "."}`);
  if (manifest.entry) {
    console.log(`  entry:    ${path.relative(process.cwd(), path.join(destDir, manifest.entry)).split(path.sep).join("/")}`);
  }
  if (shimNote) {
    console.log(`  note:     ${shimNote}`);
  }
  console.log(`  ${nextStepHint(shimManifest, runtime, destRelativeSlash)}`);

  recordInstall(projectDir, `${owner}/${name}`, {
    version: manifest.version,
    kind: manifest.kind,
    runtime,
    path: destRelativeSlash,
    installedAt: new Date().toISOString(),
    registry,
  });
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
    if (existsSync(entryPath)) {
      opts.entryContent = fs.readFileSync(entryPath, "utf8");
    }
  } else if (runtime === "claude-code" || runtime === "codex") {
    const skillPath = path.join(destDir, "SKILL.md");
    if (existsSync(skillPath)) {
      opts.existingShimContent = fs.readFileSync(skillPath, "utf8");
    }
  } else if (runtime === "cursor") {
    const mdcPath = path.join(projectDir, ".cursor", "rules", `${manifest.name}.mdc`);
    if (existsSync(mdcPath)) {
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
    }
  }
}
