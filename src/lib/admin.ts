// Admin role resolution (G-M2). Safe to import with zero env vars: with no
// `ADMIN_HANDLES` and no database, `isAdmin` resolves to `false` for everyone,
// which is the correct "no admin UI/API available" default.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { Requester } from "@/lib/requester";

/**
 * ADMIN_HANDLES, parsed into an ordered list: trimmed, lowercased, blanks
 * dropped, original (not deduped) order preserved. `adminHandleSet` below
 * only needed a Set, but machine.ts's lazy org bootstrap needs the operator's
 * declared order too (ownership goes to the *first* listed admin) — kept here
 * rather than duplicated so the two stay in sync by construction.
 *
 * `raw` defaults to the live env var; tests pass it explicitly.
 */
export function adminHandleList(raw: string | undefined = process.env.ADMIN_HANDLES): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Comma-separated handles (case-insensitive) granted admin without touching
 *  the database — set once by whoever operates the deployment. */
function adminHandleSet(): Set<string> {
  return new Set(adminHandleList());
}

/**
 * True when `requester` may act as an admin: either their handle is listed in
 * `ADMIN_HANDLES` (checked first — no database round trip needed) or their
 * `users.isAdmin` row is set. False for a signed-out caller, and for everyone
 * when neither the env var nor the database is configured.
 */
export async function isAdmin(requester: Requester | null | undefined): Promise<boolean> {
  if (!requester) return false;

  if (requester.handle && adminHandleSet().has(requester.handle.toLowerCase())) {
    return true;
  }

  const db = getDb();
  if (!db) return false;

  try {
    const [row] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, requester.id))
      .limit(1);
    return Boolean(row?.isAdmin);
  } catch {
    return false;
  }
}
