import path from "node:path";
import { readLockfile } from "../lockfile.js";
import { renderTable } from "../util.js";

export function run(args) {
  const projectDir = path.resolve(args.dir || ".");
  const { packages } = readLockfile(projectDir);
  const rows = Object.entries(packages).map(([id, entry]) => ({ id, ...entry }));

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log("No packages installed (no .openagents/installed.json in this directory).");
    return;
  }

  console.log(
    renderTable(rows, [
      { label: "PACKAGE", get: (r) => r.id },
      { label: "VERSION", get: (r) => r.version },
      { label: "KIND", get: (r) => r.kind },
      { label: "RUNTIME", get: (r) => r.runtime },
      { label: "PATH", get: (r) => r.path },
      { label: "INSTALLED", get: (r) => r.installedAt },
    ])
  );
  console.log(`\n${rows.length} package${rows.length === 1 ? "" : "s"} installed.`);
}
