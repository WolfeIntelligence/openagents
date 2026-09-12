// Handles that must never be assigned to a user — either because a route or
// static page already lives at `/<handle>` (or would be confused with one), or
// because a seed package on disk is served under `catalog/<handle>/...` and a
// same-named user account would collide with it in listings and URLs (B12a).
//
// Safe to import with zero env vars and with no `catalog/` directory present
// (e.g. a package tarball without the repo checked out) — `seedOwners()` is a
// best-effort filesystem read that degrades to an empty list.

import fs from "node:fs";
import path from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { organizations, users } from "@/lib/db/schema";

/** Static blocklist: top-level routes, auth verbs, and generic/system-sounding words. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "api",
  "app",
  "auth",
  "docs",
  "explore",
  "help",
  "login",
  "logout",
  "me",
  "null",
  "openagents",
  // /org/<handle> (G-P3, organization public pages) — see src/app/org/[handle].
  "org",
  "p",
  "pricing",
  "publish",
  "purchases",
  "root",
  "settings",
  "signin",
  "signout",
  "support",
  "system",
  "u",
  "undefined",
  "user",
  "users",
  "www",
]);

let cachedSeedOwners: string[] | undefined;

/**
 * Directory names under `<cwd>/catalog` — each one is a seed package owner
 * already being served at `/u/<owner>`. Lazy and memoized; returns an empty
 * list (never throws) when the directory doesn't exist or isn't readable.
 */
export function seedOwners(): string[] {
  if (cachedSeedOwners) return cachedSeedOwners;

  try {
    const catalogRoot = path.join(process.cwd(), "catalog");
    if (!fs.existsSync(catalogRoot)) {
      cachedSeedOwners = [];
      return cachedSeedOwners;
    }
    cachedSeedOwners = fs
      .readdirSync(catalogRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // Missing/unreadable catalog dir must never break handle derivation or publish.
    cachedSeedOwners = [];
  }

  return cachedSeedOwners;
}

/** True if `handle` (case-insensitive) is a reserved word or a seed catalog owner. */
export function isReservedHandle(handle: string): boolean {
  const lower = handle.toLowerCase();
  if (RESERVED_HANDLES.has(lower)) return true;
  return seedOwners().some((owner) => owner.toLowerCase() === lower);
}

/**
 * True when `handle` is already assigned to a user or an organization
 * (G-P3) — the two tables share one handle namespace, so a handle taken by
 * either blocks the other. Pass `excludeUserId` when checking a candidate
 * handle against every user *except* the one requesting it (a profile
 * rename shouldn't collide with the caller's own current handle). Does not
 * check reservation — see `isReservedHandle` for that; callers (auth.ts's
 * `uniqueHandle`, profile.ts's `updateOwnProfile`, orgs.ts's `createOrg`)
 * typically check both. False when the DB is off (nothing to collide with)
 * or on any lookup error — same "degrade to unavailable rather than throw"
 * convention as the rest of this module.
 */
export async function isHandleTaken(handle: string, opts?: { excludeUserId?: string }): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  try {
    const userWhere = opts?.excludeUserId
      ? and(eq(users.handle, handle), ne(users.id, opts.excludeUserId))
      : eq(users.handle, handle);
    const [userRow] = await db.select({ id: users.id }).from(users).where(userWhere).limit(1);
    if (userRow) return true;

    const [orgRow] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.handle, handle)).limit(1);
    return Boolean(orgRow);
  } catch {
    return false;
  }
}
