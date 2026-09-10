// Applies the SQL migrations under ./drizzle to DATABASE_URL, in journal order.
//
// `npm run db:push` diffs the live database against the schema and is fine for a
// single developer, but it leaves no history. This runs the committed migration
// files instead, so production changes are reviewable and repeatable. Reads
// DATABASE_URL from the environment, then .env.local / .env like drizzle.config.ts.

import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

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

async function main() {
  const url = databaseUrl();
  if (!url) {
    console.error("DATABASE_URL is not set (env, .env.local, or .env)");
    process.exit(1);
  }
  const db = drizzle(neon(url));
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
