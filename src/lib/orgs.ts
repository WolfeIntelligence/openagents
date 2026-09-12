// Organizations (G-P3): a shared publisher identity multiple users can manage
// together, plus transferring a package's ownership to/from one.
//
// `organizations.handle` shares the same namespace as `users.handle`
// (`packages.owner` is a handle either way; `packages.ownerType` says which) —
// see `src/lib/reserved.ts`'s `isHandleTaken` for the cross-table uniqueness
// check and `src/lib/auth.ts`/`src/lib/profile.ts` for where it's enforced at
// handle-assignment time.
//
// Every DB-backed export here degrades to an empty/null/`ok:false` result
// instead of throwing when `DATABASE_URL` is unset, matching the zero-env-safe
// convention used by `collections.ts`/`profile.ts`/etc. The pure helpers at
// the top have no DB dependency and are unit-tested directly in
// `./__tests__/orgs.test.ts`.

import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getCatalog } from "@/lib/catalog";
import { invalidateCatalogCache } from "@/lib/catalog/cache";
import {
  advisories,
  collectionItems,
  downloadEvents,
  downloadRollups,
  organizationMembers,
  organizations,
  packageSources,
  packages,
  packageStats,
  reviews,
  stars,
  users,
} from "@/lib/db/schema";
import { isValidBio, isValidHandleFormat, isValidWebsite, MAX_BIO_LENGTH, MAX_NAME_LENGTH } from "@/lib/profile";
import { isHandleTaken, isReservedHandle } from "@/lib/reserved";
import type { Requester } from "@/lib/requester";

/** Thrown for any org/transfer failure; `status` is the HTTP status the route should return. */
export class OrgActionError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OrgActionError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — no DB, no env, exported for unit tests.
// ---------------------------------------------------------------------------

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export function isValidOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

/** Sort weight so a member list always renders owners, then admins, then
 *  members — see `getOrgByHandle`. */
const ROLE_SORT_WEIGHT: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2 };

/** Org handles use the exact same shape as user handles (`^[a-z0-9-]{2,39}$`)
 *  since they share one namespace — reuse `profile.ts`'s validator rather
 *  than re-declare the regex a third time. */
export const isValidOrgHandleFormat = isValidHandleFormat;

export interface OrgMemberForRules {
  userId: string;
  role: OrgRole;
}

/** True when `userId` is the organization's one and only owner among `members`. */
export function isSoleOwner(members: readonly OrgMemberForRules[], userId: string): boolean {
  const owners = members.filter((m) => m.role === "owner");
  return owners.length === 1 && owners[0].userId === userId;
}

/**
 * Whether changing `userId`'s role to `newRole` is allowed given the current
 * membership. The only rule: an organization must never be left with zero
 * owners, so the sole owner can't be demoted (promoting them, or changing
 * anyone else, is always fine).
 */
export function canSetMemberRole(
  members: readonly OrgMemberForRules[],
  userId: string,
  newRole: OrgRole
): boolean {
  if (newRole === "owner") return true;
  return !isSoleOwner(members, userId);
}

/** Whether `userId` may be removed from the org (or may remove themselves)
 *  given the current membership — same "never zero owners" rule as above. */
export function canRemoveMember(members: readonly OrgMemberForRules[], userId: string): boolean {
  return !isSoleOwner(members, userId);
}

export interface TransferEligibilityInput {
  pkg: {
    owner: string;
    ownerType: "user" | "org";
    /** Seed packages (no DB row) can never be transferred. */
    source: "seed" | "db";
  };
  /** Whether the caller currently manages `pkg` — a matching user handle for
   *  a user-owned package, or owner/admin role for an org-owned one. Resolved
   *  by the caller (it needs a DB round trip); this function stays pure. */
  callerIsPackageOwner: boolean;
  /** The requested destination handle, already normalized (trimmed, lowercased). */
  to: string;
  /** The caller's own user handle, if any. */
  callerHandle?: string;
  /** True when `to` names an organization that actually exists. */
  destinationOrgExists: boolean;
  /** True when `to` names an org the caller is owner/admin of. Meaningless
   *  (and ignored) when `to` is the caller's own handle. */
  callerManagesDestinationOrg: boolean;
}

export type TransferEligibilityResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Pure eligibility check for `POST .../transfer`: the caller must currently
 * own the package, and the destination must be either the caller's own user
 * handle (moving a package back to personal ownership) or an org the caller
 * is owner/admin of. Doesn't touch the DB — every fact it needs is resolved
 * and passed in by `transferPackage` below, which is what makes this
 * unit-testable without one (see `./__tests__/orgs.test.ts`).
 */
export function evaluateTransferEligibility(input: TransferEligibilityInput): TransferEligibilityResult {
  if (input.pkg.source === "seed") {
    return { ok: false, status: 400, message: "seed packages can't be transferred" };
  }
  if (!input.callerIsPackageOwner) {
    return { ok: false, status: 403, message: "only the package's current owner can transfer it" };
  }

  const movingToSelf = Boolean(input.callerHandle) && input.to === input.callerHandle;
  if (movingToSelf) return { ok: true };

  if (!input.destinationOrgExists) {
    return { ok: false, status: 404, message: `organization not found: ${input.to}` };
  }
  if (!input.callerManagesDestinationOrg) {
    return {
      ok: false,
      status: 403,
      message: "you must be an owner or admin of the destination organization",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

type Db = NonNullable<ReturnType<typeof getDb>>;

function requireDb(): Db {
  const db = getDb();
  if (!db) {
    throw new OrgActionError(503, "organizations require a database; none is configured on this deployment");
  }
  return db;
}

/** True for a Postgres unique-violation error surfaced by the Neon driver (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "23505");
}

type OrgRow = typeof organizations.$inferSelect;

export interface OrgSummary {
  handle: string;
  displayName: string;
  bio: string | null;
  website: string | null;
  avatarUrl: string | null;
  createdAt: string;
  packageCount: number;
}

export interface OrgMemberRow {
  handle: string;
  name: string | null;
  image: string | null;
  role: OrgRole;
}

export interface OrgDetail extends OrgSummary {
  id: string;
  members: OrgMemberRow[];
}

function toOrgSummary(row: OrgRow, packageCount: number): OrgSummary {
  return {
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    website: row.website,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
    packageCount,
  };
}

async function packageCountFor(db: Db, handle: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(packages)
    .where(eq(packages.owner, handle));
  return row?.count ?? 0;
}

/** The public org profile: displayName/bio/website/avatar, package count, and
 *  the full member list (members are visible to everyone — it's a public
 *  org). Null when the org doesn't exist, the DB is off, or the lookup throws. */
export async function getOrgByHandle(handle: string): Promise<OrgDetail | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.handle, handle)).limit(1);
    if (!org) return null;

    const [memberRows, packageCount] = await Promise.all([
      db
        .select({
          role: organizationMembers.role,
          handle: users.handle,
          name: users.name,
          image: users.image,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(organizationMembers.userId, users.id))
        .where(eq(organizationMembers.orgId, org.id)),
      packageCountFor(db, handle),
    ]);

    const members: OrgMemberRow[] = memberRows
      // A member whose own handle is somehow unset can't be linked to/shown
      // meaningfully — exclude rather than render a broken row.
      .filter((m): m is typeof m & { handle: string } => Boolean(m.handle))
      .map((m) => ({ handle: m.handle, name: m.name, image: m.image, role: m.role as OrgRole }))
      .sort(
        (a, b) => ROLE_SORT_WEIGHT[a.role] - ROLE_SORT_WEIGHT[b.role] || a.handle.localeCompare(b.handle)
      );

    return { id: org.id, ...toOrgSummary(org, packageCount), members };
  } catch {
    return null;
  }
}

export interface MemberOrgSummary {
  handle: string;
  displayName: string;
  role: OrgRole;
}

/** Every org `userId` belongs to, with their role in each — for `GET
 *  /api/v1/orgs?member=me` and the `/settings/orgs` list. Empty (not a throw)
 *  when the DB is off or the lookup fails. */
export async function listOrgsForMember(userId: string): Promise<MemberOrgSummary[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select({
        handle: organizations.handle,
        displayName: organizations.displayName,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
      .where(eq(organizationMembers.userId, userId))
      .orderBy(asc(organizations.displayName));

    return rows.map((r) => ({ handle: r.handle, displayName: r.displayName, role: r.role as OrgRole }));
  } catch {
    return [];
  }
}

/** The caller's role in `orgHandle`, or null when they aren't a member (or
 *  the org/DB doesn't exist/isn't configured). The building block every
 *  owner/admin gate in this module (and `access.ts`'s `isPackageOwner`) is
 *  built on. */
export async function getMemberRole(orgHandle: string, userId: string): Promise<OrgRole | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const [row] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
      .where(and(eq(organizations.handle, orgHandle), eq(organizationMembers.userId, userId)))
      .limit(1);
    return row ? (row.role as OrgRole) : null;
  } catch {
    return null;
  }
}

export type CreateOrgResult = { ok: true; org: OrgSummary } | { ok: false; status: number; message: string };

/**
 * Creates an org owned solely by `requester` (role "owner"). `handle` must
 * match the shared handle format, not be reserved, and not already belong to
 * a user or another org (B12a-style check, extended to orgs — see
 * `reserved.ts`'s `isHandleTaken`).
 */
export async function createOrg(
  requester: Requester,
  input: { handle: string; displayName: string; bio?: string; website?: string }
): Promise<CreateOrgResult> {
  const db = getDb();
  if (!db) {
    return { ok: false, status: 503, message: "organizations require a database; none is configured on this deployment" };
  }

  const handle = input.handle.trim().toLowerCase();
  if (!isValidOrgHandleFormat(handle)) {
    return {
      ok: false,
      status: 400,
      message: "handle must be 2-39 characters: lowercase letters, digits, and hyphens",
    };
  }
  if (isReservedHandle(handle)) {
    return { ok: false, status: 400, message: "that handle is reserved" };
  }

  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, status: 400, message: "displayName is required" };
  if (displayName.length > MAX_NAME_LENGTH) {
    return { ok: false, status: 400, message: `displayName must be ${MAX_NAME_LENGTH} characters or fewer` };
  }
  if (input.bio !== undefined && !isValidBio(input.bio)) {
    return { ok: false, status: 400, message: `bio must be ${MAX_BIO_LENGTH} characters or fewer` };
  }
  if (input.website !== undefined && !isValidWebsite(input.website)) {
    return { ok: false, status: 400, message: "website must be a valid https:// URL, or empty" };
  }

  if (await isHandleTaken(handle)) {
    return { ok: false, status: 409, message: "that handle is already taken" };
  }

  try {
    const [org] = await db
      .insert(organizations)
      .values({
        handle,
        displayName,
        bio: input.bio?.trim() || null,
        website: input.website?.trim() || null,
        createdByUserId: requester.id,
      })
      .returning();

    await db.insert(organizationMembers).values({ orgId: org.id, userId: requester.id, role: "owner" });

    return { ok: true, org: toOrgSummary(org, 0) };
  } catch (err) {
    // Race with another create of the same handle — the pre-check above
    // already caught the common case, this is the DB's unique constraint
    // catching the concurrent one.
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, message: "that handle is already taken" };
    }
    return { ok: false, status: 500, message: "failed to create organization" };
  }
}

export interface OrgPatch {
  displayName?: string;
  bio?: string | null;
  website?: string | null;
  avatarUrl?: string | null;
}

/** Updates an org's own profile fields (not membership). Returns `"invalid"`
 *  for a bad `displayName`/`bio`/`website`, `null` when the org doesn't exist
 *  or the DB is off. */
export async function updateOrg(
  handle: string,
  patch: OrgPatch
): Promise<OrgSummary | null | "invalid"> {
  const db = getDb();
  if (!db) return null;

  if (patch.displayName !== undefined) {
    const trimmed = patch.displayName.trim();
    if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return "invalid";
  }
  if (patch.bio !== undefined && patch.bio !== null && !isValidBio(patch.bio)) return "invalid";
  if (patch.website !== undefined && patch.website !== null && !isValidWebsite(patch.website)) return "invalid";

  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.handle, handle)).limit(1);
    if (!org) return null;

    const set: Partial<typeof organizations.$inferInsert> = {};
    if (patch.displayName !== undefined) set.displayName = patch.displayName.trim();
    if (patch.bio !== undefined) set.bio = patch.bio?.trim() || null;
    if (patch.website !== undefined) set.website = patch.website?.trim() || null;
    if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;

    const row = Object.keys(set).length
      ? (await db.update(organizations).set(set).where(eq(organizations.id, org.id)).returning())[0]
      : org;

    return toOrgSummary(row, await packageCountFor(db, row.handle));
  } catch {
    return null;
  }
}

export type DeleteOrgResult = { ok: true } | { ok: false; status: number; message: string };

/** Deletes an org outright — refused (409) while it still owns any packages
 *  (transfer them out first). Cascades to `organization_members` via the
 *  FK's `onDelete: "cascade"`. */
export async function deleteOrg(handle: string): Promise<DeleteOrgResult> {
  const db = requireDb();

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.handle, handle)).limit(1);
  if (!org) return { ok: false, status: 404, message: `organization not found: ${handle}` };

  const [owned] = await db.select({ id: packages.id }).from(packages).where(eq(packages.owner, handle)).limit(1);
  if (owned) {
    return {
      ok: false,
      status: 409,
      message: "transfer this organization's packages to another owner before deleting it",
    };
  }

  await db.delete(organizations).where(eq(organizations.id, org.id));
  return { ok: true };
}

export type MemberWriteResult =
  | { ok: true; members: OrgMemberRow[] }
  | { ok: false; status: number; message: string };

/**
 * Adds `targetHandle` to the org (or updates their role if already a member).
 * Refuses to demote the org's sole owner (`canSetMemberRole`) — promote
 * someone else to owner first.
 */
export async function upsertMember(
  orgHandle: string,
  targetHandle: string,
  role: string
): Promise<MemberWriteResult> {
  if (!isValidOrgRole(role)) {
    return { ok: false, status: 400, message: `role must be one of: ${ORG_ROLES.join(", ")}` };
  }
  const db = getDb();
  if (!db) {
    return { ok: false, status: 503, message: "organizations require a database; none is configured on this deployment" };
  }

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.handle, orgHandle)).limit(1);
  if (!org) return { ok: false, status: 404, message: `organization not found: ${orgHandle}` };

  const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.handle, targetHandle)).limit(1);
  if (!targetUser) return { ok: false, status: 404, message: `user not found: ${targetHandle}` };

  const currentMembers = await db
    .select({ userId: organizationMembers.userId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.orgId, org.id));
  const rules: OrgMemberForRules[] = currentMembers.map((m) => ({ userId: m.userId, role: m.role as OrgRole }));

  const alreadyMember = rules.some((m) => m.userId === targetUser.id);
  if (alreadyMember && !canSetMemberRole(rules, targetUser.id, role)) {
    return { ok: false, status: 400, message: "can't demote the organization's last owner" };
  }

  await db
    .insert(organizationMembers)
    .values({ orgId: org.id, userId: targetUser.id, role })
    .onConflictDoUpdate({
      target: [organizationMembers.orgId, organizationMembers.userId],
      set: { role },
    });

  const detail = await getOrgByHandle(orgHandle);
  return { ok: true, members: detail?.members ?? [] };
}

/**
 * Removes `targetHandle` from the org — an owner/admin removing someone else,
 * or a member removing themselves (both authorized at the route level; this
 * only enforces the "never zero owners" rule via `canRemoveMember`).
 */
export async function removeMember(orgHandle: string, targetHandle: string): Promise<DeleteOrgResult> {
  const db = getDb();
  if (!db) {
    return { ok: false, status: 503, message: "organizations require a database; none is configured on this deployment" };
  }

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.handle, orgHandle)).limit(1);
  if (!org) return { ok: false, status: 404, message: `organization not found: ${orgHandle}` };

  const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.handle, targetHandle)).limit(1);
  if (!targetUser) return { ok: false, status: 404, message: `user not found: ${targetHandle}` };

  const currentMembers = await db
    .select({ userId: organizationMembers.userId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.orgId, org.id));
  const rules: OrgMemberForRules[] = currentMembers.map((m) => ({ userId: m.userId, role: m.role as OrgRole }));

  if (!rules.some((m) => m.userId === targetUser.id)) {
    return { ok: false, status: 404, message: "that user is not a member of this organization" };
  }
  if (!canRemoveMember(rules, targetUser.id)) {
    return { ok: false, status: 400, message: "the last owner can't leave; promote another member to owner first" };
  }

  await db
    .delete(organizationMembers)
    .where(and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.userId, targetUser.id)));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Package transfer
// ---------------------------------------------------------------------------

export interface TransferResult {
  /** "owner/name" under the new owner. */
  id: string;
  owner: string;
  ownerType: "user" | "org";
}

/**
 * Transfers `owner/name` to `to` — either an org the caller is owner/admin of,
 * or the caller's own user handle (moving a package back to personal
 * ownership). See `evaluateTransferEligibility` for the pure rule this
 * enforces once every fact it needs has been resolved from the DB below.
 *
 * `packages.owner`/`ownerType` (the single source of truth every other read
 * in the app keys off — `catalog.get`, `resolveAccess`, publish's owner
 * check) is updated FIRST, in its own statement, keyed by the package's own
 * primary key id. Only once that succeeds does this rewrite the satellite
 * tables that are merely keyed by the (owner, name) text pair —
 * `package_stats`, `stars`, `reviews`, `download_events`, `download_rollups`,
 * `collection_items`, `advisories`, `package_sources` — one at a time,
 * logging (not throwing) on a per-table failure. neon-http has no
 * transactions, so this order is deliberate: if a satellite write fails
 * partway through, the package itself is already consistently owned by `to`
 * everywhere that matters, and the affected satellite table just lags
 * (stats/star counts are recomputed from real usage over time; the rest are
 * curation/analytics data, not access control). Doing it in the other order
 * — satellites first, `packages` last — risks the opposite and worse
 * failure: satellite rows already pointing at the new owner while `packages`
 * itself still resolves under the old one, so every page/API keyed by owner
 * would disagree with each other for as long as the gap lasts.
 */
export async function transferPackage(
  requester: Requester,
  owner: string,
  name: string,
  to: string
): Promise<TransferResult> {
  const db = requireDb();

  const [row] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.owner, owner), eq(packages.name, name)))
    .limit(1);
  if (!row) {
    // Distinguish "doesn't exist at all" from "exists only as a seed
    // package" for a clearer error — seed packages have no `packages` row.
    const catalog = await getCatalog();
    const seedPkg = await catalog.get(owner, name);
    if (seedPkg && seedPkg.source === "seed") {
      throw new OrgActionError(400, "seed packages can't be transferred");
    }
    throw new OrgActionError(404, `package not found: ${owner}/${name}`);
  }

  const toHandle = to.trim().toLowerCase();
  if (!isValidHandleFormat(toHandle)) {
    throw new OrgActionError(400, `"to" must be a valid handle`);
  }

  const currentOwnerType: "user" | "org" = row.ownerType === "org" ? "org" : "user";
  let callerIsPackageOwner: boolean;
  if (currentOwnerType === "org") {
    const role = await getMemberRole(row.owner, requester.id);
    callerIsPackageOwner = role === "owner" || role === "admin";
  } else {
    callerIsPackageOwner = Boolean(requester.handle && requester.handle === row.owner);
  }

  const movingToSelf = Boolean(requester.handle) && toHandle === requester.handle;
  let destinationOrgExists = false;
  let callerManagesDestinationOrg = false;
  if (!movingToSelf) {
    const [destOrg] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.handle, toHandle))
      .limit(1);
    destinationOrgExists = Boolean(destOrg);
    if (destOrg) {
      const role = await getMemberRole(toHandle, requester.id);
      callerManagesDestinationOrg = role === "owner" || role === "admin";
    }
  }

  const eligibility = evaluateTransferEligibility({
    pkg: { owner: row.owner, ownerType: currentOwnerType, source: "db" },
    callerIsPackageOwner,
    to: toHandle,
    callerHandle: requester.handle,
    destinationOrgExists,
    callerManagesDestinationOrg,
  });
  if (!eligibility.ok) throw new OrgActionError(eligibility.status, eligibility.message);

  const newOwnerType: "user" | "org" = movingToSelf ? "user" : "org";
  const oldOwner = row.owner;

  try {
    await db
      .update(packages)
      .set({ owner: toHandle, ownerType: newOwnerType, updatedAt: new Date() })
      .where(eq(packages.id, row.id));
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new OrgActionError(409, `${toHandle} already owns a package named "${name}"`);
    }
    throw err;
  }

  const satelliteUpdates: { label: string; run: () => Promise<unknown> }[] = [
    {
      label: "package_stats",
      run: () =>
        db.update(packageStats).set({ owner: toHandle }).where(and(eq(packageStats.owner, oldOwner), eq(packageStats.name, name))),
    },
    {
      label: "stars",
      run: () => db.update(stars).set({ owner: toHandle }).where(and(eq(stars.owner, oldOwner), eq(stars.name, name))),
    },
    {
      label: "reviews",
      run: () => db.update(reviews).set({ owner: toHandle }).where(and(eq(reviews.owner, oldOwner), eq(reviews.name, name))),
    },
    {
      label: "download_events",
      run: () =>
        db
          .update(downloadEvents)
          .set({ owner: toHandle })
          .where(and(eq(downloadEvents.owner, oldOwner), eq(downloadEvents.name, name))),
    },
    {
      label: "download_rollups",
      run: () =>
        db
          .update(downloadRollups)
          .set({ owner: toHandle })
          .where(and(eq(downloadRollups.owner, oldOwner), eq(downloadRollups.name, name))),
    },
    {
      label: "collection_items",
      run: () =>
        db
          .update(collectionItems)
          .set({ owner: toHandle })
          .where(and(eq(collectionItems.owner, oldOwner), eq(collectionItems.name, name))),
    },
    {
      label: "advisories",
      run: () =>
        db.update(advisories).set({ owner: toHandle }).where(and(eq(advisories.owner, oldOwner), eq(advisories.name, name))),
    },
    {
      label: "package_sources",
      run: () =>
        db
          .update(packageSources)
          .set({ owner: toHandle })
          .where(and(eq(packageSources.owner, oldOwner), eq(packageSources.name, name))),
    },
  ];

  for (const { label, run } of satelliteUpdates) {
    try {
      await run();
    } catch (err) {
      // Best-effort past this point — see the doc comment above. In practice
      // `package_sources`'s (owner, name) unique constraint is the one
      // realistic way this throws (the new owner already has a repo-linked
      // package of the same name); every other table here has no unique
      // constraint on (owner, name) alone.
      console.error(`[orgs] transfer ${oldOwner}/${name} -> ${toHandle}: ${label} update failed:`, err);
    }
  }

  invalidateCatalogCache();
  return { id: `${toHandle}/${name}`, owner: toHandle, ownerType: newOwnerType };
}
