import { registryUrl, splitPackageRef, fetchJson, existsSync } from "../util.js";
import { detectRuntime } from "../runtimes.js";

export async function run(args) {
  const ref = args._[0];
  if (!ref) {
    console.error("✗ usage: openagents info <owner/name[@version]> [--registry <url>] [--json]");
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
  const runtime = detectRuntime(process.cwd(), existsSync);
  let pkg;
  try {
    pkg = await fetchJson(`${registry}/api/v1/packages/${owner}/${name}`, { runtime });
  } catch (err) {
    console.error(`✗ could not fetch package: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const m = pkg.manifest || pkg;

  if (args.json) {
    console.log(JSON.stringify(pkg, null, 2));
    if (version && version !== m.version) {
      console.error(`(note: version pinning isn't supported by this registry yet; showing latest, ${m.version})`);
    }
    return;
  }

  const stats = pkg.stats || {};

  if (version && version !== m.version) {
    console.log(`Note: version pinning isn't supported by this registry yet; showing latest (${m.version}).\n`);
  }

  console.log(`${m.title || `${owner}/${name}`}  (${owner}/${name}@${m.version})`);
  console.log(`${m.summary || ""}`);
  console.log("");
  console.log(`  kind:      ${m.kind}`);
  console.log(`  license:   ${m.license}`);
  console.log(`  tags:      ${(m.tags || []).join(", ")}`);
  console.log(`  runtimes:  ${(m.runtimes || []).join(", ")}`);
  console.log(`  pricing:   ${m.pricing?.model === "free" ? "free" : `${m.pricing?.model} - $${(m.pricing?.amountCents ?? 0) / 100} ${m.pricing?.currency || ""}`}`);
  console.log(`  entry:     ${m.entry}`);
  console.log(`  files:     ${(m.files || []).join(", ")}`);
  if (m.requires && m.requires.length) {
    console.log(`  requires:  ${m.requires.join(", ")}`);
  }
  if (typeof stats.downloads === "number" || typeof stats.stars === "number") {
    console.log(`  stats:     ${stats.downloads ?? 0} downloads, ${stats.stars ?? 0} stars`);
  }
  if (m.inputs && m.inputs.length) {
    console.log("\nInputs:");
    for (const inp of m.inputs) {
      console.log(`  - ${inp.name} (${inp.type}${inp.required ? ", required" : ""})${inp.description ? ` — ${inp.description}` : ""}`);
    }
  }

  console.log(`\nInstall: openagents add ${owner}/${name}`);
}
