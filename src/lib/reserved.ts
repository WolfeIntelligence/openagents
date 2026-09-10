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
