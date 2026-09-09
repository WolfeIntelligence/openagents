// Lazy Drizzle client over Neon's HTTP driver. Safe to import with zero env vars:
// getDb() returns null until DATABASE_URL is set, and no client is constructed at
// module load time.

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Db = NeonHttpDatabase<typeof schema>;

let cached: Db | null | undefined;

export function isDbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Returns a lazily-created Drizzle client, or null when DATABASE_URL is unset. */
export function getDb(): Db | null {
  if (cached !== undefined) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = null;
    return cached;
  }

  const sql = neon(url);
  cached = drizzle(sql, { schema });
  return cached;
}
