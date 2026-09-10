import fs from "node:fs";
import path from "node:path";
import { readLockfile, removeInstall } from "../lockfile.js";
import { isPathInside, splitPackageRef } from "../util.js";

export function run(args) {
  const ref = args._[0];
  if (!ref) {
    console.error("✗ usage: openagents remove <owner/name> [--dir <path>] [--runtime <id>]");
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

  const id = `${owner}/${name}`;
  const projectDir = path.resolve(args.dir || ".");
  const lock = readLockfile(projectDir);
  const entry = lock.packages[id];
  if (!entry) {
    console.error(
      `✗ ${id} is not recorded as installed in ${path.relative(process.cwd(), projectDir) || "."} (see "openagents list")`
    );
    process.exitCode = 1;
    return;
  }

  const runtime = args.runtime || entry.runtime;
  const installPath = path.resolve(projectDir, entry.path);
  if (installPath === projectDir || !isPathInside(projectDir, installPath)) {
    console.error(`✗ refusing to remove ${installPath}: recorded path is not safely inside ${projectDir}`);
    process.exitCode = 1;
    return;
  }

  let removedDir = false;
  if (fs.existsSync(installPath)) {
    fs.rmSync(installPath, { recursive: true, force: true });
    removedDir = true;
  }

  let removedShim = false;
  if (runtime === "cursor") {
    const mdcPath = path.join(projectDir, ".cursor", "rules", `${name}.mdc`);
    if (fs.existsSync(mdcPath)) {
      fs.rmSync(mdcPath, { force: true });
      removedShim = true;
    }
  }

  removeInstall(projectDir, id);

  console.log(`✓ removed ${id}${removedDir ? ` (${entry.path})` : " (install directory was already gone)"}`);
  if (removedShim) {
    console.log(`  also removed .cursor/rules/${name}.mdc`);
  }
}
