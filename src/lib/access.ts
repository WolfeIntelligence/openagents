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
  const isOwner = Boolean(session?.user?.handle && session.user.handle === pkg.owner);

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
