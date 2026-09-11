// Unit test for `computeBaselineRows` in ../../../scripts/db-baseline.ts —
// pure/sync/no DB access, run against a small fixture migrations folder
// under ./fixtures/drizzle rather than the real (much larger) ./drizzle, so
// the expected hashes below stay a handful of stable, easy-to-verify
// constants instead of tracking whatever the real schema happens to be.
//
// The hashes are what `sha256(<raw .sql file contents>).hex()` actually
// produces for the two fixture files (verified independently with Node's
// `crypto` against the checked-in fixture content) — this pins
// `computeBaselineRows` to that exact algorithm (drizzle-orm's own migrator;
// see node_modules/drizzle-orm/migrator.js's `readMigrationFiles`), so a
// future edit that hashed the split statements instead of the raw file, or
// used the wrong journal field for the timestamp, would fail this test
// rather than silently writing history a real `migrate()` call won't
// recognize.
//
// Run with:
//   npx tsx --test src/lib/__tests__/baseline.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeBaselineRows } from "../../../scripts/db-baseline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_FOLDER = path.join(__dirname, "fixtures", "drizzle");

test("computes one row per journal entry, in journal order", () => {
  const rows = computeBaselineRows(FIXTURE_FOLDER);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.tag),
    ["0000_fixture_one", "0001_fixture_two"]
  );
});

test("hash is sha256 of the raw migration file contents", () => {
  const rows = computeBaselineRows(FIXTURE_FOLDER);
  assert.equal(
    rows[0].hash,
    "b6a22c1e82a625c72944174c53438a6852f9029d19c71f49e13ccf81f4d1ff77",
    "0000_fixture_one.sql's hash should match sha256(<raw file contents>)"
  );
  assert.equal(
    rows[1].hash,
    "8235b07cbcbd90864a8cb91f85b8a47c9518bb783e3057540182298ce10cf74a",
    "0001_fixture_two.sql's hash should match sha256(<raw file contents>), " +
      "computed over the whole file (including the statement-breakpoint " +
      "marker), not the individual split statements"
  );
  for (const row of rows) {
    assert.match(row.hash, /^[0-9a-f]{64}$/, "hash should be a lowercase sha256 hex digest");
  }
});

test("created_at is the journal entry's own `when`, not the current time", () => {
  const rows = computeBaselineRows(FIXTURE_FOLDER);
  assert.equal(rows[0].createdAt, 1700000000000);
  assert.equal(rows[1].createdAt, 1700000100000);
});
