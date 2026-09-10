// Packs the CLI into public/cli/openagents.tgz at build time.
//
// The install command shown on the site is `npx <spec> add owner/name`. Until the
// `openagents` package is published to npm, <spec> is the URL of this tarball (npx
// installs straight from a tarball URL), so visitors get a working command with no
// npm account involved. Once it is published, set NEXT_PUBLIC_CLI_PACKAGE=openagents
// and the site switches back to the short form; this script keeps running harmlessly.
//
// Runs as `prebuild` (npm run build) — `npm pack` needs no installed dependencies.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.join(root, "cli");
const outDir = path.join(root, "public", "cli");
const target = path.join(outDir, "openagents.tgz");

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith(".tgz")) fs.rmSync(path.join(outDir, f));
}

// `npm pack --json` prints [{ filename, ... }] for the tarball it wrote.
const output = execSync(`npm pack --json --pack-destination "${outDir}"`, {
  cwd: cliDir,
  encoding: "utf-8",
  shell: true,
  stdio: ["ignore", "pipe", "inherit"],
});
const [{ filename }] = JSON.parse(output);
fs.renameSync(path.join(outDir, filename), target);
const size = fs.statSync(target).size;
console.log(`[pack-cli] wrote public/cli/openagents.tgz (${(size / 1024).toFixed(1)} KB)`);
