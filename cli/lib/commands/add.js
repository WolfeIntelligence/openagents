import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { registryUrl, splitPackageRef, fetchJson, existsSync } from "../util.js";
import { installDir, detectRuntime, RUNTIME_IDS } from "../runtimes.js";

export async function run(args) {
  const ref = args._[0];
  if (!ref) {
    console.error("✗ usage: openagents add <owner/name> [--runtime <id>] [--registry <url>] [--dir <path>]");
    process.exitCode = 1;
    return;
  }

  let owner, name;
  try {
    ({ owner, name } = splitPackageRef(ref));
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
    pkg = await fetchJson(`${registry}/api/v1/packages/${owner}/${name}`);
  } catch (err) {
    console.error(`✗ could not fetch package manifest: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const manifest = pkg.manifest || pkg;
  const downloadUrl =
    pkg.downloadUrl || `${registry}/api/v1/packages/${owner}/${name}/download`;

  const destRelative = installDir(runtime, name);
  const destDir = path.join(projectDir, destRelative);

  console.log(`Downloading ${owner}/${name}@${manifest.version || "?"} ...`);
  let res;
  try {
    res = await fetch(downloadUrl);
  } catch (err) {
    console.error(`✗ could not download package: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!res.ok || !res.body) {
    console.error(`✗ download failed: HTTP ${res.status}`);
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

  console.log(`\n✓ installed ${owner}/${name}@${manifest.version || "?"} for runtime "${runtime}"`);
  console.log(`  location: ${path.relative(process.cwd(), destDir) || "."}`);
  if (manifest.entry) {
    console.log(`  entry:    ${path.join(destRelative, manifest.entry).split(path.sep).join("/")}`);
  }
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
