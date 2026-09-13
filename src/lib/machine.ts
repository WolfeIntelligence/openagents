// Machine publisher (WolfeOS): lets one trusted automated system publish and
// import packages using a server-side shared secret instead of a
// person-minted API token. See docs/content/docs/api.md#machine-publishers.
//
// Design, in full:
//   - Configured by one env var, OPENAGENTS_MACHINE_SECRET. Unset or shorter
//     than MIN_SECRET_LENGTH characters means the whole machine path is off —
//     every export here degrades cleanly, matching the zero-env-safe
//     convention used throughout this codebase (see tokens.ts, orgs.ts).
//   - A request with `Authorization: Bearer <that secret>` (checked in
//     constant time — see `verifyMachineSecret`) acts as a fixed principal:
//     user handle MACHINE_HANDLE, scoped to MACHINE_SCOPES (read, download,
//     publish — no star, no review, and — since token minting already
//     requires `via === "session"`, see src/app/api/v1/tokens/route.ts — it
//     can't mint a token either).
//   - That principal may publish/import only under MACHINE_OWNER_HANDLE, an
//     organization (`checkMachineOwner`, enforced in publish.ts). Both handles
//     are reserved (src/lib/reserved.ts) so a human can never claim either out
//     from under the machine.
//   - The org and the machine user are created lazily, server-side, the first
//     time a valid machine request needs them (`ensureMachinePrincipal`): the
//     machine user joins the org as role "member" (it doesn't manage the org —
//     `checkMachineOwner` is what actually gates publishing, not org role),
//     and the org's owner is the first handle listed in ADMIN_HANDLES that
//     resolves to a real user, or failing that whichever user already has
//     `users.isAdmin` set (`resolveMachineOrgOwnerId`/`chooseMachineOrgOwnerId`).
//
// Every DB-touching export degrades to `null`/`false` instead of throwing when
// `DATABASE_URL` is unset, same convention as orgs.ts/tokens.ts. The pure
// decision functions (`verifyMachineSecret`, `checkMachineOwner`,
// `chooseMachineOrgOwnerId`) have no DB dependency and are unit-tested
// directly in `./__tests__/machine.test.ts`.

import { timingSafeEqual } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { organizationMembers, organizations, users } from "@/lib/db/schema";
import { adminHandleList } from "@/lib/admin";

/** The machine principal's fixed user handle. Reserved in reserved.ts so no
 *  human signup/rename/org-create can claim it. */
export const MACHINE_HANDLE = "wolfe-factory";

/** The one organization handle a machine request may publish/import under.
 *  Reserved in reserved.ts for the same reason as MACHINE_HANDLE. */
export const MACHINE_OWNER_HANDLE = "wolfe";

/** Subset of TOKEN_SCOPES (tokens.ts) the machine principal carries: it can
 *  read, download, and publish — never star or review, and (via `via !==
 *  "session"`, enforced by the tokens route) never mint a token. */
export const MACHINE_SCOPES = ["read", "download", "publish"] as const;

/** How a machine-authenticated actor is identified in logs — never the
 *  secret, never a raw user id. */
export const MACHINE_PRINCIPAL_LABEL = `machine:${MACHINE_HANDLE}`;

/** Below this length, OPENAGENTS_MACHINE_SECRET is treated as not configured
 *  at all — the machine path stays off rather than accepting a weak secret. */
export const MIN_SECRET_LENGTH = 32;

// ---------------------------------------------------------------------------
// Pure decision logic — no DB, no framework imports, unit-tested directly.
// ---------------------------------------------------------------------------

/**
 * Constant-time check of `candidate` (the bearer token a request sent)
 * against OPENAGENTS_MACHINE_SECRET. Returns false — never throws — for an
 * unset or too-short secret, an empty candidate, or a length mismatch (a
 * length check has to run before `timingSafeEqual`, which throws on
 * differently-sized buffers; the token/secret length itself isn't the secret
 * being protected here, only its value is).
 *
 * `secret` defaults to the live env var; tests pass it explicitly so they
 * don't have to mutate process.env for every case.
 */
export function verifyMachineSecret(
  candidate: string,
  secret: string | undefined = process.env.OPENAGENTS_MACHINE_SECRET
): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  if (!candidate) return false;

  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export type MachineOwnerCheck = { ok: true } | { ok: false; status: 403; message: string };

/** Whether a machine-authenticated publish/import may target `owner`. The
 *  only allowed value is MACHINE_OWNER_HANDLE — enforced here regardless of
 *  what manifest.owner otherwise would have matched (a machine publish never
 *  falls back to "owner === the caller's own handle" the way a human's does,
 *  since MACHINE_HANDLE itself isn't a publishable owner for machine calls). */
export function checkMachineOwner(owner: string): MachineOwnerCheck {
  if (owner === MACHINE_OWNER_HANDLE) return { ok: true };
  return {
    ok: false,
    status: 403,
    message: `machine publishers may only publish under "${MACHINE_OWNER_HANDLE}"`,
  };
}

/**
 * Pure ownership decision for the lazily-created org: the first handle in
 * `adminHandles` (order matters — see admin.ts's `adminHandleList`) that
 * `usersByHandle` (a handle -> userId map for exactly those admin handles,
 * resolved by the caller with one query — see `resolveMachineOrgOwnerId`
 * below) shows as a real user, else `existingAdminUserId` (also resolved by
 * the caller, typically the oldest `users.isAdmin` row), else null when
 * neither resolves to anyone — meaning the org can't be created yet. No DB
 * access here, which is what makes this unit-testable without one.
 */
export function chooseMachineOrgOwnerId(
  adminHandles: readonly string[],
  usersByHandle: ReadonlyMap<string, string>,
  existingAdminUserId: string | null
): string | null {
  for (const handle of adminHandles) {
    const id = usersByHandle.get(handle);
    if (id) return id;
  }
  return existingAdminUserId;
}

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

type Db = NonNullable<ReturnType<typeof getDb>>;

/** Resolves who should own a newly-created "wolfe" org — see
 *  `chooseMachineOrgOwnerId` for the decision itself. Issues at most two
 *  queries (skips the ADMIN_HANDLES one when that env var is unset). */
async function resolveMachineOrgOwnerId(db: Db): Promise<string | null> {
  const adminHandles = adminHandleList();

  const adminHandleRowsPromise: Promise<{ id: string; handle: string | null }[]> = adminHandles.length
    ? db.select({ id: users.id, handle: users.handle }).from(users).where(inArray(users.handle, adminHandles))
    : Promise.resolve([]);

  const [adminHandleRows, existingAdminRows] = await Promise.all([
    adminHandleRowsPromise,
    db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).orderBy(asc(users.createdAt)).limit(1),
  ]);

  const usersByHandle = new Map<string, string>();
  for (const row of adminHandleRows) {
    if (row.handle) usersByHandle.set(row.handle, row.id);
  }

  return chooseMachineOrgOwnerId(adminHandles, usersByHandle, existingAdminRows[0]?.id ?? null);
}

export interface MachinePrincipal {
  /** users.id — stable, so rate limits and any future per-principal state key
   *  off it exactly like a real signed-in user's. */
  id: string;
  handle: string;
}

/**
 * Get-or-create the machine user and the "wolfe" org, and make sure the
 * machine user is a member of it (role "member" — see the file header for why
 * that's enough). Idempotent: safe to call on every machine-authenticated
 * request, not just the first. Returns null (never throws) when the database
 * is off, or when the org doesn't exist yet and no owner can be resolved for
 * it (logged once via console.error — operator error: set ADMIN_HANDLES or
 * grant an existing user isAdmin).
 */
export async function ensureMachinePrincipal(): Promise<MachinePrincipal | null> {
  const db = getDb();
  if (!db) return null;

  try {
    let [machineUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, MACHINE_HANDLE))
      .limit(1);

    if (!machineUser) {
      const [inserted] = await db
        .insert(users)
        .values({ handle: MACHINE_HANDLE, name: "WolfeOS" })
        .onConflictDoNothing({ target: users.handle })
        .returning({ id: users.id });
      machineUser =
        inserted ??
        (await db.select({ id: users.id }).from(users).where(eq(users.handle, MACHINE_HANDLE)).limit(1))[0];
    }
    if (!machineUser) return null;

    let [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.handle, MACHINE_OWNER_HANDLE))
      .limit(1);

    if (!org) {
      const ownerUserId = await resolveMachineOrgOwnerId(db);
      if (!ownerUserId) {
        console.error(
          `[machine] cannot create org "${MACHINE_OWNER_HANDLE}": no ADMIN_HANDLES entry or existing admin user resolves to an owner`
        );
        return null;
      }

      const [inserted] = await db
        .insert(organizations)
        .values({ handle: MACHINE_OWNER_HANDLE, displayName: "Wolfe", createdByUserId: ownerUserId })
        .onConflictDoNothing({ target: organizations.handle })
        .returning({ id: organizations.id });
      org =
        inserted ??
        (await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.handle, MACHINE_OWNER_HANDLE))
          .limit(1))[0];
      if (!org) return null;

      await db
        .insert(organizationMembers)
        .values({ orgId: org.id, userId: ownerUserId, role: "owner" })
        .onConflictDoNothing({ target: [organizationMembers.orgId, organizationMembers.userId] });
    }

    await db
      .insert(organizationMembers)
      .values({ orgId: org.id, userId: machineUser.id, role: "member" })
      .onConflictDoNothing({ target: [organizationMembers.orgId, organizationMembers.userId] });

    return { id: machineUser.id, handle: MACHINE_HANDLE };
  } catch (err) {
    console.error("[machine] failed to ensure machine principal:", err);
    return null;
  }
}
