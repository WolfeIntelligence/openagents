// Single source of truth for "who can see what" on a package (B2).
//
// Before this module existed, the download route had its own inline paywall
// check and the raw-file route and file-viewer page had none at all — a paid
// package's files were readable for free through either of them. Every place
// that needs to gate content on purchase status should call `resolveAccess`
// instead of re-deriving the same three booleans, so the three surfaces (raw
// file API, file-viewer page, tarball download) can never drift out of sync
// again.
//
// Safe to import with zero env vars: `hasPurchased` (from `./purchases`)
// no-ops to `false` when `DATABASE_URL` is unset, and `auth()` returns a null
// session, so a signed-out, DB-less request simply sees free packages as
// downloadable and everything else as gated.

import type { Session } from "next-auth";
import type { Package } from "@/lib/types";
import { hasPurchased } from "@/lib/purchases";
import { getMemberRole } from "@/lib/orgs";

/**
 * Paths on a paid package that stay readable without a purchase — enough to
 * evaluate the package before buying it (the manifest and the README are also
 * how a buyer confirms what they're about to pay for). Every other file on a
 * paid package requires `canDownload`.
 */
export const PREVIEW_PATHS = new Set<string>(["README.md", "openagent.yaml"]);

export function isFreePackage(pkg: Package): boolean {
  return pkg.manifest.pricing.model === "free" || pkg.manifest.pricing.amountCents === 0;
}

/** The minimal shape `isPackageOwner` needs — deliberately narrower than the
 *  full `Package` type since `ownerType` isn't threaded onto `Package` yet
 *  outside of what this workstream owns (see the doc comment below). */
export interface OwnableRef {
  owner: string;
  /** "org" when the org branch below applies; anything else (including
   *  absent, for a `Package` that doesn't carry this field yet) is treated
   *  as a plain user-owned package. */
  ownerType?: string;
}

/** The minimal caller identity `isPackageOwner` needs, satisfied by both a
 *  `Requester` (route handlers) and `Session["user"]` (server components). */
export interface OwnerIdentity {
  id?: string;
  handle?: string;
}

function identityFrom(requesterOrSession: OwnerIdentity | Session | null | undefined): OwnerIdentity {
  if (!requesterOrSession) return {};
  if ("user" in requesterOrSession) {
    return { id: requesterOrSession.user?.id, handle: requesterOrSession.user?.handle ?? undefined };
  }
  return requesterOrSession;
}

/**
 * True when `requesterOrSession` counts as `pkg`'s owner (G-P3): a signed-in
 * user whose handle matches `pkg.owner`, when `pkg.ownerType` is "user" or
 * absent — OR, when `pkg.ownerType` is "org", a member of that org with role
 * "owner" or "admin" (a plain "member" gets paid-download access via
 * `canDownload` below, same as anyone else, but doesn't count as an owner —
 * they can't publish new versions or manage the package's status). This is
 * the one helper every owner check in the app should call instead of
 * re-deriving `handle === pkg.owner`, so org-owned packages behave
 * consistently everywhere access is decided.
 *
 * NEEDS CHANGE ELSEWHERE: `Package`/`PackageSummary` (src/lib/types.ts) don't
 * carry `ownerType` yet, and catalog/db.ts's row-to-Package mapping (outside
 * the `creator()` function this workstream owns) doesn't select it either —
 * only `packages.ownerType` in the DB and this function's own direct queries
 * (publish.ts, orgs.ts's `transferPackage`) know about it today. Until
 * `ownerType` is added to those types and threaded through, every `Package`
 * object read via `catalog.get`/`catalog.list` has `ownerType` absent, so
 * this function's org branch never triggers from catalog-sourced data — it
 * silently (and safely) falls back to the plain user-handle check, matching
 * pre-G-P3 behavior. That means org members won't yet show as the owner on
 * `/p/[owner]/[name]` or get the owner's free-download bypass there until
 * that plumbing lands.
 */
export async function isPackageOwner(
  requesterOrSession: OwnerIdentity | Session | null | undefined,
  pkg: OwnableRef
): Promise<boolean> {
  const { id, handle } = identityFrom(requesterOrSession);

  if (pkg.ownerType === "org") {
    if (!id) return false;
    const role = await getMemberRole(pkg.owner, id);
    return role === "owner" || role === "admin";
  }

  return Boolean(handle && handle === pkg.owner);
}

export interface Access {
  isFree: boolean;
  isOwner: boolean;
  /** True when a `paid` purchase row exists for this user. Always false for a
   *  free package or the owner — there's nothing to purchase in either case. */
  purchased: boolean;
  /** Owner of a free package, the package's own owner, or a paid purchaser —
   *  the union that may fetch the tarball or read every file in it. */
  canDownload: boolean;
  /** Whether `path` is readable by this viewer right now. */
  canReadFile(path: string): boolean;
}

/**
 * Resolves what `session` may access on `pkg`. `session` may be null/undefined
 * (signed out) — every field simply comes back as the signed-out default.
 */
export async function resolveAccess(
  pkg: Package,
  session: Session | null | undefined
): Promise<Access> {
  const isFree = isFreePackage(pkg);
  const isOwner = await isPackageOwner(session, pkg);

  // Free packages and owners never need a purchase lookup — skip the query
  // entirely rather than asking the database a question whose answer can't
  // change the result.
  const purchased =
    !isFree && !isOwner && session?.user?.id
      ? await hasPurchased(session.user.id, pkg.owner, pkg.name)
      : false;

  const canDownload = isFree || isOwner || purchased;

  return {
    isFree,
    isOwner,
    purchased,
    canDownload,
    canReadFile: (path: string) => canDownload || PREVIEW_PATHS.has(path),
  };
}
