import fs from "node:fs";
import path from "node:path";
import { parseManifest, validateManifest, validateManifestFiles } from "../manifest.js";
import { listFilesRecursive } from "../util.js";

export function run(args) {
  const dir = path.resolve(args._[0] || ".");
  const manifestPath = path.join(dir, "openagent.yaml");

  if (!fs.existsSync(manifestPath)) {
    console.error(`✗ ${path.relative(process.cwd(), manifestPath) || "openagent.yaml"} not found`);
    process.exitCode = 1;
    return;
  }

  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (err) {
    console.error(`✗ could not read openagent.yaml: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let manifest;
  try {
    manifest = parseManifest(raw);
  } catch (err) {
    console.error(`✗ could not parse openagent.yaml: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const issues = validateManifest(manifest);

  const availablePaths = listFilesRecursive(dir).filter(
    (p) => p !== "openagent.yaml" && p !== ".stats.json"
  );
  issues.push(...validateManifestFiles(manifest, availablePaths));

  if (!fs.existsSync(path.join(dir, "README.md"))) {
    issues.push("README.md not found alongside openagent.yaml (required by the catalog quality bar)");
  }

  const warnings = [];
  if (manifest && typeof manifest.name === "string") {
    const dirName = path.basename(dir);
    if (dirName !== manifest.name) {
      warnings.push(`directory name "${dirName}" does not match manifest name "${manifest.name}"`);
    }
  }

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
