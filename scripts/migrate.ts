// Applies the SQL migrations under ./drizzle to DATABASE_URL, in journal order.
//
// `npm run db:push` diffs the live database against the schema and is fine for a
// single developer, but it leaves no history. This runs the committed migration
// files instead, so production changes are reviewable and repeatable. Reads
// DATABASE_URL from the environment, then .env.local / .env like drizzle.config.ts.
//
// One wrinkle (Y8): a database that has only ever been synced with `db:push`
// has no `drizzle.__drizzle_migrations` table, so handing it straight to
// drizzle-orm's `migrate()` would try to run 0000_cloudy_anthem.sql's
// `CREATE TABLE`s again and fail on "already exists". Before applying
// anything, this script checks for exactly that situation — no migration
// history yet, but `packages` (or any other app table) already exists — and
// if so runs scripts/db-baseline.ts's baseline first, recording every
// migration currently under ./drizzle as already applied (see that file's
// header for why that's safe) without running their SQL. A brand-new,
// genuinely empty database skips the baseline and just runs every migration
// for real, same as always.
//
// This is what makes a single `npm run db:migrate` work unattended on
// production: first run baselines existing history and (if any migrations
// were added after the baseline point) applies just those; every run after
// that is a normal `migrate()` with nothing special to detect.

import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { runBaseline, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "./db-baseline";
import type { NeonSql } from "./db-baseline";

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

async function tableExists(sql: NeonSql, schema: string, table: string): Promise<boolean> {
  const rows = (await sql.query(
    `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    [schema, table]
  )) as { count: number }[];
  return (rows[0]?.count ?? 0) > 0;
}

/** True for exactly the "db:push-created database" case scripts/db-baseline.ts
 *  exists for: no rows recorded in the migrations table (whether because the
 *  table itself doesn't exist yet, or it exists but is empty) while the app's
 *  own schema is already present. `packages` is checked as the app-table
 *  stand-in — every real deployment has it, and a truly fresh/empty database
 *  (nothing ever pushed or migrated) won't, so this correctly says "no" for
 *  that case and lets `migrate()` run every migration for real. */
async function needsBaseline(sql: NeonSql): Promise<boolean> {
  const migrationsTableExists = await tableExists(sql, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE);
  if (migrationsTableExists) {
    const rows = (await sql.query(
      `SELECT count(*)::int AS count FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`
    )) as { count: number }[];
    if ((rows[0]?.count ?? 0) > 0) return false; // history already recorded
  }
  return tableExists(sql, "public", "packages");
}

async function main() {
  const url = databaseUrl();
  if (!url) {
    console.error("DATABASE_URL is not set (env, .env.local, or .env)");
    process.exit(1);
  }
  const sql = neon(url);

  if (await needsBaseline(sql)) {
    console.log(
      "No migration history found on a database that already has `packages` " +
        "— this looks like a `db:push`-created database. Baselining existing " +
        "migrations as applied before continuing (see scripts/db-baseline.ts)."
    );
    // Only the initial migration (the full schema as of the first `drizzle-kit
    // generate`) is recorded as applied: a db:push-created database is known to
    // match that one, while anything generated later must actually run.
    const { baselined } = await runBaseline(sql, undefined, { onlyInitial: true });
    console.log(`Baselined ${baselined} migration(s) as already applied.`);
  }

  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
