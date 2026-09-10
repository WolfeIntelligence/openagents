// `openagents outdated` (X6a): for each lockfile entry, report its current
// installed version, the newest version satisfying its recorded
// `requestedRange` ("wanted"), and the package's overall latest version —
// npm's current/wanted/latest triad. Exits 1 when anything is outdated, like
// `npm outdated`.

import path from "node:path";
import { fetchJson, registryUrl, renderTable } from "../util.js";
import { readLockfile } from "../lockfile.js";
import { maxSatisfying } from "../semver.js";

export async function run(args) {
  const projectDir = path.resolve(args.dir || ".");
  const { packages } = readLockfile(projectDir);
  const ids = Object.keys(packages);

  if (ids.length === 0) {
    if (args.json) {
      console.log(JSON.stringify([], null, 2));
    } else {
      console.log("No packages installed (no .openagents/installed.json in this directory).");
    }
    return;
  }

  const registry = registryUrl(args.registry);
  const rows = [];
  let anyOutdated = false;

  for (const id of ids) {
    const entry = packages[id];
    const [owner, name] = id.split("/");
    const base = `${registry}/api/v1/packages/${owner}/${name}`;

    let detail;
    try {
      detail = await fetchJson(base);
    } catch (err) {
      rows.push({ package: id, current: entry.version, wanted: "?", latest: "?", deprecated: "", error: err.message });
      anyOutdated = true;
      continue;
    }

    const latest = detail.manifest?.version || detail.latestVersion || "?";
    let wanted = latest;
    if (entry.requestedRange) {
      try {
        const versionsRes = await fetchJson(`${base}/versions`);
        const versions = (versionsRes.versions || []).map((v) => v.version);
        wanted = maxSatisfying(versions, entry.requestedRange) || entry.version;
      } catch {
        wanted = entry.version;
      }
    }

    const deprecated = detail.status === "deprecated" ? "yes" : "";
    if (entry.version !== latest) anyOutdated = true;
    rows.push({ package: id, current: entry.version, wanted, latest, deprecated });
  }

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(
      renderTable(rows, [
        { label: "PACKAGE", get: (r) => r.package },
        { label: "CURRENT", get: (r) => r.current },
        { label: "WANTED", get: (r) => r.wanted },
        { label: "LATEST", get: (r) => r.latest },
        { label: "DEPRECATED", get: (r) => r.deprecated },
      ])
    );
    if (!anyOutdated) {
      console.log("\nAll packages are up to date.");
    }
  }

  if (anyOutdated) {
    process.exitCode = 1;
  }
}
