// Loads every seed package (catalog/<owner>/<name>/) through the seed
// catalog and prints load errors, if any. Also checks that every package
// carries a valid `.meta.json` (see scripts/sync-catalog-meta.ts) so seed
// dates never silently fall back to build time (audit B8). Exits non-zero on
// failure.
//
// Run with: npm run check:catalog (== npx tsx scripts/check-catalog.ts)

import fs from "node:fs";
import path from "node:path";
import { seedCatalog, loadCatalogErrors } from "../src/lib/catalog/seed";

const CATALOG_ROOT = path.join(process.cwd(), "catalog");

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

interface MetaCheckFailure {
  id: string;
  reason: string;
}

/** Verifies every catalog/<owner>/<name>/ directory has a `.meta.json` with
 *  parsable `createdAt`/`updatedAt` dates. Does not use seed.ts's loader,
 *  which deliberately falls back to build time instead of failing — this
 *  check exists precisely so that fallback never happens silently in CI. */
function checkMetaFiles(): MetaCheckFailure[] {
  const failures: MetaCheckFailure[] = [];

  for (const owner of listDirs(CATALOG_ROOT)) {
    for (const name of listDirs(path.join(CATALOG_ROOT, owner))) {
      const id = `${owner}/${name}`;
      const metaPath = path.join(CATALOG_ROOT, owner, name, ".meta.json");

      if (!fs.existsSync(metaPath)) {
        failures.push({ id, reason: "missing .meta.json — run `npm run sync:meta` and commit the result" });
        continue;
      }

      let meta: { createdAt?: unknown; updatedAt?: unknown };
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      } catch {
        failures.push({ id, reason: ".meta.json is not valid JSON" });
        continue;
      }

      for (const field of ["createdAt", "updatedAt"] as const) {
        const value = meta[field];
        if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
          failures.push({ id, reason: `.meta.json ${field} (${JSON.stringify(value)}) is unparsable — re-run \`npm run sync:meta\`` });
        }
      }
    }
  }

  return failures;
}

async function main() {
  const errors = loadCatalogErrors();
  const { items, total } = await seedCatalog.list({ limit: 1000 });

  console.log(`catalog/: ${total} valid package(s), ${errors.length} error(s)\n`);

  let failures = 0;

  for (const item of items) {
    const pkg = await seedCatalog.get(item.owner, item.name);
    if (!pkg) {
      console.error(`  FAIL ${item.id}: catalog.get() returned null after list()`);
      failures++;
      continue;
    }
    const entryFile = await seedCatalog.getFile(item.owner, item.name, pkg.manifest.entry);
    if (!entryFile) {
      console.error(`  FAIL ${item.id}: entry file "${pkg.manifest.entry}" not readable via getFile()`);
      failures++;
      continue;
    }
    console.log(`  ok   ${item.id}@${item.version} (${item.kind}, ${item.pricing.model})`);
  }

  for (const err of errors) {
    console.error(`  FAIL ${err.owner}/${err.name}: ${err.message}`);
    failures++;
  }

  const metaFailures = checkMetaFiles();
  if (metaFailures.length > 0) {
    console.error(`\n.meta.json problems:`);
    for (const f of metaFailures) {
      console.error(`  FAIL ${f.id}: ${f.reason}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} problem(s) found.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll good.`);
  }
}

main().catch((err) => {
  console.error("check-catalog crashed:", err);
  process.exitCode = 1;
});
