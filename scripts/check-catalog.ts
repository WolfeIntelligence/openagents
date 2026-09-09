// Loads every seed package (catalog/<owner>/<name>/) through the seed
// catalog and prints load errors, if any. Exits non-zero on failure.
//
// Run with: npm run check:catalog (== npx tsx scripts/check-catalog.ts)

import { seedCatalog, loadCatalogErrors } from "../src/lib/catalog/seed";

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
