// Self-service profile read/update (name, bio, website, handle).
//
// A handle was previously permanent once set at first sign-in (see the B12b
// note in `./auth`) — there was nowhere for a renamed handle to safely land
// while packages still pointed at the old one via `packages.owner`. This
// module allows exactly the case that's actually safe: a user who owns zero
// packages yet may still pick a different handle, since there is nothing on
// disk or in the DB keyed by their current one.
//
// Safe to import with zero env vars: every export no-ops (or reports
// "unavailable") when DATABASE_URL is unset.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packages, users } from "@/lib/db/schema";
import { isHandleTaken, isReservedHandle } from "@/lib/reserved";

export const MAX_BIO_LENGTH = 500;
export const MAX_NAME_LENGTH = 100;
const HANDLE_RE = /^[a-z0-9-]{2,39}$/;

// ---------------------------------------------------------------------------
// Pure helpers — no DB access, safe to unit test directly.
// ---------------------------------------------------------------------------

/** True when `handle` matches the shape every handle must have: 2-39 chars,
 *  lowercase letters, digits, and hyphens only. Does not check reservation or
 *  uniqueness — see `updateOwnProfile` for those. */
export function isValidHandleFormat(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

/** True when `bio` is within the length cap. Empty string is valid (clears it). */
export function isValidBio(bio: string): boolean {
  return bio.length <= MAX_BIO_LENGTH;
}

/** True when `website` is either empty (clears it) or an `https://` URL. Plain
 *  `http://` is rejected — every profile link this renders opens in a new tab
 *  next to other users' content, so it's worth holding to the safer scheme. */
export function isValidWebsite(website: string): boolean {
  if (website === "") return true;
  try {
    return new URL(website).protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// DB-backed reads and writes.
// ---------------------------------------------------------------------------

export interface OwnProfile {
  name: string | null;
  bio: string | null;
  website: string | null;
  handle: string | null;
  image: string | null;
}

/** The caller's own editable profile fields. Null when the DB is off, the user
 *  doesn't exist, or the lookup throws. */
export async function getOwnProfile(userId: string): Promise<OwnProfile | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select({
        name: users.name,
        bio: users.bio,
        website: users.website,
        handle: users.handle,
        image: users.image,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

export interface ProfileUpdateInput {
  name?: string;
  bio?: string;
  website?: string;
  handle?: string;
}

export type ProfileUpdateResult =
  | { ok: true; profile: OwnProfile }
  | { ok: false; status: number; message: string };

/**
 * Updates whichever of `name`/`bio`/`website`/`handle` are present in `input`.
 * A `handle` change is only allowed when the caller currently owns zero
 * packages (`packages.owner` count), and the new handle must match the format,
 * not be reserved, and not already belong to someone else.
 */
export async function updateOwnProfile(
  userId: string,
  input: ProfileUpdateInput
): Promise<ProfileUpdateResult> {
  const db = getDb();
  if (!db) {
    return { ok: false, status: 503, message: "profile editing requires a database; none is configured on this deployment" };
  }
  if (input.bio !== undefined && !isValidBio(input.bio)) {
    return { ok: false, status: 400, message: `bio must be ${MAX_BIO_LENGTH} characters or fewer` };
  }
  if (input.website !== undefined && !isValidWebsite(input.website)) {
    return { ok: false, status: 400, message: "website must be a valid https:// URL, or empty" };
  }
  if (input.name !== undefined && input.name.trim().length > MAX_NAME_LENGTH) {
    return { ok: false, status: 400, message: `name must be ${MAX_NAME_LENGTH} characters or fewer` };
  }

  try {
    const [current] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1);
    if (!current) {
      return { ok: false, status: 404, message: "user not found" };
    }

    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name.trim() || null;
    if (input.bio !== undefined) patch.bio = input.bio.trim() || null;
    if (input.website !== undefined) patch.website = input.website.trim() || null;

    if (input.handle !== undefined && input.handle !== current.handle) {
      if (!isValidHandleFormat(input.handle)) {
        return {
          ok: false,
          status: 400,
          message: "handle must be 2-39 characters: lowercase letters, digits, and hyphens",
        };
      }
      if (isReservedHandle(input.handle)) {
        return { ok: false, status: 400, message: "that handle is reserved" };
      }

      const [ownedPackage] = current.handle
        ? await db.select({ id: packages.id }).from(packages).where(eq(packages.owner, current.handle)).limit(1)
        : [];
      if (ownedPackage) {
        return {
          ok: false,
          status: 400,
          message: "you can't change your handle while you own published packages",
        };
      }

      // G-P3: orgs and users share one handle namespace, so a handle already
      // taken by an organization blocks a user rename too (`isHandleTaken`
      // checks both tables).
      if (await isHandleTaken(input.handle, { excludeUserId: userId })) {
        return { ok: false, status: 409, message: "that handle is already taken" };
      }

      patch.handle = input.handle;
    }

    if (Object.keys(patch).length > 0) {
      await db.update(users).set(patch).where(eq(users.id, userId));
    }

    const profile = await getOwnProfile(userId);
    if (!profile) {
      return { ok: false, status: 500, message: "update did not persist" };
    }
    return { ok: true, profile };
  } catch {
    return { ok: false, status: 500, message: "failed to update profile" };
  }
}

/** Whether `userId` currently owns any published packages — drives whether the
 *  handle field is editable on the settings page. False (not "unknown") when the
 *  DB is off or the user has no handle yet, since there's nothing to own either way. */
export async function ownsAnyPackages(userId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const [row] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row?.handle) return false;
    const [owned] = await db.select({ id: packages.id }).from(packages).where(eq(packages.owner, row.handle)).limit(1);
    return Boolean(owned);
  } catch {
    return false;
  }
}
