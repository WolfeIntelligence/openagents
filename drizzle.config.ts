import fs from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so it never sees .env.local the way the app does.
// Read DATABASE_URL from the environment first, then fall back to .env.local, so
// `npm run db:push` works from a checkout without exporting anything by hand.
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    try {
      const match = fs
        .readFileSync(file, "utf-8")
        .match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
      if (match?.[1]) return match[1];
    } catch {
      // File absent or unreadable — try the next one.
    }
  }
  return "";
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl(),
  },
});
