// One-time adoption script for switching a `drizzle-kit push`-managed database
// over to tracked migrations (scripts/migrate.ts) — see that file's comment
// and src/content/docs/self-hosting.md#migrations for the full story.
//
// The problem: production has been kept in sync with src/lib/db/schema.ts by
// running `npm run db:push` (which diffs the live database against the
// schema and applies whatever's missing) rather than by applying the SQL
// files under ./drizzle in order. That means production already has every
// table/column/index currently checked into drizzle/, but its
// `drizzle`.`__drizzle_migrations` table — the bookkeeping drizzle-orm's own
// migrator (scripts/migrate.ts) reads to know what's already been run — has
// never been created, let alone populated. Pointing `db:migrate` at a
// database in that state would try to `CREATE TABLE "account" (...)` etc.
// from 0000_cloudy_anthem.sql all over again and fail on "already exists".
//
// The fix: record every migration currently under ./drizzle as already
// applied, without running a single statement from them. This doesn't lie
// about the database's state — `db:push` already put those objects there —
// it just gives the migrator the history entries it expects so it starts
// applying SQL from the first migration that's genuinely new (e.g. this
// batch's 0001_*, if a `db:push` hasn't already been run for it since — see
// the "Needs change elsewhere" note in this workstream's final report for
// the one assumption this rests on).
//
// Table shape, schema/table names, and the hash/timestamp format below are
// copied from drizzle-orm's own migrator so a real `migrate()` call
// afterward recognizes these rows as its own and needs no other adjustment:
//   - node_modules/drizzle-orm/migrator.js (`readMigrationFiles`): hash is
//     `sha256(<raw migration .sql file contents>).hex()` — the *whole* file,
//     computed before it's split on "--> statement-breakpoint" — and the
//     timestamp is each journal entry's own `when` (not `Date.now()`).
//   - node_modules/drizzle-orm/neon-http/migrator.js (`migrate`): reads/writes
//     `"drizzle"."__drizzle_migrations"` (id serial pk, hash text not null,
//     created_at bigint) unless overridden via `migrationsSchema`/
//     `migrationsTable` config, which scripts/migrate.ts doesn't set, so the
//     defaults are what has to match here.
//
// Refuses to run if that table already has rows: either this already ran
// (re-running would insert duplicate/incorrect history) or real migrations
// have genuinely been applied already (baselining on top would misrecord
// which ones actually executed). Run via `npm run db:baseline`, or let
// scripts/migrate.ts invoke it automatically the first time it finds an
// empty/missing migrations table on a database that already has `packages`.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";

/** The concrete return type of `neon(url)` as called in this file and
 *  scripts/migrate.ts (default `arrayMode`/`fullResults`, both `false`) —
 *  `ReturnType<typeof neon>` widens to `NeonQueryFunction<boolean, boolean>`
 *  because `neon` is generic, which then fails to accept the concrete value
 *  `neon(url)` actually produces. Named here so migrate.ts can share it. */
export type NeonSql = NeonQueryFunction<false, false>;

const ENV_LINE = /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m;

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    try {
      const match = fs.readFileSync(file, "utf-8").match(ENV_LINE);
      if (match?.[1]) return match[1];
    } catch {
      // try the next file
    }
  }
  return "";
}

export const MIGRATIONS_FOLDER = "./drizzle";
export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

interface JournalEntry {
  tag: string;
  when: number;
}

export interface BaselineRow {
  tag: string;
  hash: string;
  createdAt: number;
}

/**
 * Reads `<migrationsFolder>/meta/_journal.json` and computes the exact
 * (hash, created_at) pair drizzle-orm's migrator would compute for each
 * entry — see the file header for exactly where this logic comes from.
 * Pure/sync/no DB access, so it's the piece the unit test exercises against
 * a fixture journal rather than a live database.
 */
/** `limit` restricts the baseline to the first N journal entries — the automatic
 *  baseline in scripts/migrate.ts passes 1 so only the initial full-schema migration is
 *  marked applied and every later migration still runs for real. */
export function computeBaselineRows(migrationsFolder: string = MIGRATIONS_FOLDER, limit?: number): BaselineRow[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as { entries: JournalEntry[] };
  return journal.entries.slice(0, limit ?? journal.entries.length).map((entry) => {
    const raw = fs.readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf-8");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    return { tag: entry.tag, hash, createdAt: entry.when };
  });
}

/**
 * Runs the baseline against an already-connected neon query function.
 * Separated from `main()` so scripts/migrate.ts can call it directly with
 * the connection it already opened, instead of shelling out to this file.
 * Throws (rather than `process.exit`) on refusal so the caller decides what
 * to do — `main()` below turns that into an exit code; migrate.ts lets it
 * propagate as a hard failure, since applying migrations on top of a
 * database whose history is in an unknown state isn't safe to paper over.
 */
export async function runBaseline(
  sql: NeonSql,
  migrationsFolder: string = MIGRATIONS_FOLDER,
  options: { onlyInitial?: boolean } = {}
): Promise<{ baselined: number }> {
  await sql.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const existing = (await sql.query(
    `SELECT count(*)::int AS count FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`
  )) as { count: number }[];
  const existingCount = existing[0]?.count ?? 0;
  if (existingCount > 0) {
    throw new Error(
      `"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" already has ${existingCount} row(s) — ` +
        "refusing to baseline. This database either already ran this baseline, or already has " +
        "real migration history; re-baselining on top of either would misrecord what actually ran."
    );
  }

  const rows = computeBaselineRows(migrationsFolder, options.onlyInitial ? 1 : undefined);
  for (const row of rows) {
    await sql.query(
      `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`,
      [row.hash, row.createdAt]
    );
  }
  return { baselined: rows.length };
}

async function main() {
  const url = databaseUrl();
  if (!url) {
    console.error("DATABASE_URL is not set (env, .env.local, or .env)");
    process.exit(1);
  }
  const sql = neon(url);
  const { baselined } = await runBaseline(sql);
  console.log(
    `Baselined ${baselined} migration(s) in "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" as already applied (no migration SQL was executed).`
  );
}

// Only run as a script when invoked directly (`npm run db:baseline`) — not
// when scripts/migrate.ts imports `runBaseline`/`computeBaselineRows` or the
// test file imports `computeBaselineRows`. Compared as file URLs (rather than
// raw paths) so this works the same on Windows (`C:\...`) and POSIX.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
