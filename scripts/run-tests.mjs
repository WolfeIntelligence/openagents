// Runs every src/lib/__tests__/*.test.ts file under node's built-in test
// runner, transpiled on the fly by tsx. A plain `node --test **/*.test.ts`
// glob relies on shell expansion, which behaves differently (or not at all)
// on Windows vs. POSIX shells — this lists files with `fs` instead so
// `npm test` works the same everywhere.
//
// Run with: npm test (== node scripts/run-tests.mjs)

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "..", "src", "lib", "__tests__");

const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => path.join(testDir, f));

if (files.length === 0) {
  console.error(`No *.test.ts files found in ${testDir}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);
