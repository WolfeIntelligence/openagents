import fs from "node:fs";
import path from "node:path";
import { parseManifest, validateManifest, validateManifestFiles } from "../manifest.js";
import { listFilesRecursive } from "../util.js";

/**
 * Validate the package in `dir`: parse `openagent.yaml`, check it against
 * the manifest schema, cross-check `entry`/`files` against what's actually
 * on disk, and require a `README.md`. Returns `{ manifest, issues, warnings
 * }` — `manifest` is `null` when `openagent.yaml` is missing/unreadable/
 * unparsable (the first `issues` entry says which).
 *
 * Shared by the `validate` command and `pack.js` (`openagents publish`) so
 * both enforce exactly the same rules — see G-T2.
 */
export function validatePackageDir(dir) {
  const manifestPath = path.join(dir, "openagent.yaml");
  const issues = [];
  const warnings = [];

  if (!fs.existsSync(manifestPath)) {
    issues.push(`${path.relative(process.cwd(), manifestPath) || "openagent.yaml"} not found`);
    return { manifest: null, issues, warnings };
  }

  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (err) {
    issues.push(`could not read openagent.yaml: ${err.message}`);
    return { manifest: null, issues, warnings };
  }

  let manifest;
  try {
    manifest = parseManifest(raw);
  } catch (err) {
    issues.push(`could not parse openagent.yaml: ${err.message}`);
    return { manifest: null, issues, warnings };
  }

  issues.push(...validateManifest(manifest));

  const availablePaths = listFilesRecursive(dir).filter(
    (p) => p !== "openagent.yaml" && p !== ".stats.json"
  );
  issues.push(...validateManifestFiles(manifest, availablePaths));

  if (!fs.existsSync(path.join(dir, "README.md"))) {
    issues.push("README.md not found alongside openagent.yaml (required by the catalog quality bar)");
  }

  if (manifest && typeof manifest.name === "string") {
    const dirName = path.basename(dir);
    if (dirName !== manifest.name) {
      warnings.push(`directory name "${dirName}" does not match manifest name "${manifest.name}"`);
    }
  }

  return { manifest, issues, warnings };
}

export function run(args) {
  const dir = path.resolve(args._[0] || ".");
  const manifestPath = path.join(dir, "openagent.yaml");
  const { manifest, issues, warnings } = validatePackageDir(dir);

  if (issues.length === 0) {
    console.log(`✓ ${manifest.owner}/${manifest.name}@${manifest.version} is valid`);
    console.log(`  kind: ${manifest.kind}   entry: ${manifest.entry}   files: ${manifest.files.length}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
    return;
  }

  console.error(`✗ ${issues.length} issue${issues.length === 1 ? "" : "s"} found in ${manifestPath}:`);
  for (const issue of issues) console.error(`  - ${issue}`);
  for (const w of warnings) console.error(`  warning: ${w}`);
  process.exitCode = 1;
}
