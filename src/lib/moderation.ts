// Package lifecycle and moderation: status transitions, deletion, reports, and the
// admin queue. Backs the owner-facing status/report routes and the admin API.
//
// Every mutating export here requires a database and throws `PackageActionError(503,
// …)` when one isn't configured — callers (route handlers) may check `isDbEnabled()`
// first for a cheaper early-out, but it's safe to call these directly either way.
// The pure validation helpers at the top have no DB dependency and are unit-tested
// directly in `./__tests__/moderation.test.ts`.

import { and, eq } from "drizzle-orm";
import { getCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db/client";
import { packages, packageStats, purchases, reports, stars } from "@/lib/db/schema";
import { NAME_RE } from "@/lib/manifest";
import type { PackageStatus } from "@/lib/types";

/** Thrown for any moderation failure; `status` is the HTTP status the route should return. */
export class PackageActionError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PackageActionError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Pure validation helpers — no DB, no env, exported for unit tests.
// ---------------------------------------------------------------------------

/** Statuses settable through the moderation API. "pending" is only ever assigned
 *  at publish time (by the publishing workstream) — this API can move a package
 *  out of "pending" but never back into it. */
export const SETTABLE_STATUSES = ["live", "unlisted", "deprecated"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export function isSettableStatus(value: string): value is SettableStatus {
  return (SETTABLE_STATUSES as readonly string[]).includes(value);
}

/** Structurally valid `{from -> to}` moves, independent of who's asking. No
 *  no-ops (re-setting the current status) and no path back to "pending". */
const STRUCTURAL_TRANSITIONS: Record<PackageStatus, readonly PackageStatus[]> = {
  pending: ["live", "unlisted"],
  live: ["unlisted", "deprecated"],
  unlisted: ["live", "deprecated"],
  deprecated: ["live", "unlisted"],
};

export function isValidStatusTransition(from: PackageStatus, to: PackageStatus): boolean {
  return STRUCTURAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * `pending -> live` is the one transition an owner can't always make themselves
 * — it's a self-approval. It requires an admin when `requireReview` is true;
 * every other transition (including an admin doing the same move) is open to
 * the owner. `requireReview` is `REQUIRE_REVIEW`'s presence in env, resolved by
 * the caller (see `isReviewRequired`) so this stays a pure function.
 */
export function requiresAdminForTransition(
  from: PackageStatus,
  to: PackageStatus,
  requireReview: boolean
): boolean {
  return requireReview && from === "pending" && to === "live";
}

/** Presence-based, like `isDbEnabled`/`isStripeEnabled` elsewhere: any non-empty
 *  value turns review on. Unset (the zero-env default) means owners may self-approve. */
export function isReviewRequired(): boolean {
  return Boolean(process.env.REQUIRE_REVIEW);
}

export const REPORT_REASONS = ["prompt-injection", "malware", "license", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export function isValidReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}

/** `"owner/name"`, both halves matching the same shape enforced at publish time
 *  (`NAME_RE` in manifest.ts). Format only — existence is checked against the
 *  catalog separately, since that needs an async lookup. */
export function isValidReplacementIdFormat(value: string): boolean {
  const parts = value.split("/");
  if (parts.length !== 2) return false;
  const [owner, name] = parts;
  return NAME_RE.test(owner) && NAME_RE.test(name);
}

const MAX_MESSAGE_CHARS = 500;
const MAX_DETAILS_CHARS = 2000;

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

type Db = NonNullable<ReturnType<typeof getDb>>;

function requireDb(): Db {
  const db = getDb();
  if (!db) {
    throw new PackageActionError(
      503,
      "package moderation requires a database; none is configured on this deployment"
    );
  }
  return db;
}

async function getDbPackageRow(db: Db, owner: string, name: string) {
  const [row] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.owner, owner), eq(packages.name, name)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Status changes and deletion (owner or admin)
// ---------------------------------------------------------------------------

export interface SetPackageStatusArgs {
  owner: string;
  name: string;
  status: string;
  /** Freeform note, ≤500 chars. Doubles as two different things depending on
   *  the target status: the deprecation notice shown by `DeprecationBanner`
   *  when `status === "deprecated"`, or an admin's rejection reason when
   *  rejecting a pending package (`status === "unlisted"`) — see the doc
   *  comment on `deprecationMessage` usage below. Cleared (set to null) when
   *  omitted, so a stale note never survives an unrelated status change. */
  message?: string;
  /** "owner/name" of the package that supersedes this one. Only persisted
   *  when the target status is "deprecated"; ignored (and cleared) otherwise. */
  replacementId?: string;
  isAdmin: boolean;
  requireReview: boolean;
}

export interface SetPackageStatusResult {
  id: string;
  status: PackageStatus;
}

/**
 * Moves a package to a new status, enforcing both the structural transition
 * table and the pending->live admin gate above. Also used by the admin API for
 * approve (`status: "live"`) and reject (`status: "unlisted"`, with `message`
 * carrying the rejection reason) — there is deliberately only one code path
 * that writes `packages.status`.
 *
 * Design note on where a rejection reason lives: rather than adding a new
 * column or writing a synthetic `reports` row for something that isn't really
 * a report, a reject reuses `packages.deprecationMessage` as a general-purpose
 * "status note" column. `DeprecationBanner` (public) only ever reads it when
 * `status === "deprecated"`; `OwnerActions` (owner/admin only) may surface the
 * raw note for any status, which is how an owner sees why their submission was
 * rejected.
 */
export async function setPackageStatus(args: SetPackageStatusArgs): Promise<SetPackageStatusResult> {
  const { owner, name, isAdmin, requireReview } = args;

  if (!isSettableStatus(args.status)) {
    throw new PackageActionError(400, `status must be one of: ${SETTABLE_STATUSES.join(", ")}`);
  }
  const target = args.status;

  let message: string | undefined;
  if (args.message !== undefined) {
    if (args.message.length > MAX_MESSAGE_CHARS) {
      throw new PackageActionError(400, `message must be ${MAX_MESSAGE_CHARS} characters or fewer`);
    }
    message = args.message.trim() || undefined;
  }

  let replacementId: string | undefined;
  if (args.replacementId !== undefined) {
    if (!isValidReplacementIdFormat(args.replacementId)) {
      throw new PackageActionError(400, `replacementId must look like "owner/name"`);
    }
    replacementId = args.replacementId;
  }

  const db = requireDb();
  const row = await getDbPackageRow(db, owner, name);
  if (!row) throw new PackageActionError(404, `package not found: ${owner}/${name}`);

  const current = row.status as PackageStatus;
  if (!isValidStatusTransition(current, target)) {
    throw new PackageActionError(400, `cannot move a package from "${current}" to "${target}"`);
  }
  if (requiresAdminForTransition(current, target, requireReview) && !isAdmin) {
    throw new PackageActionError(403, "only an admin can approve a pending package");
  }

  if (replacementId) {
    const [replacementOwner, replacementName] = replacementId.split("/");
    const catalog = await getCatalog();
    const replacementPkg = await catalog.get(replacementOwner, replacementName);
    if (!replacementPkg) {
      throw new PackageActionError(400, `replacement package not found: ${replacementId}`);
    }
  }

  await db
    .update(packages)
    .set({
      status: target,
      deprecationMessage: message ?? null,
      replacementId: target === "deprecated" ? (replacementId ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(packages.id, row.id));

  return { id: `${owner}/${name}`, status: target };
}

/** Toggles `featured`, independent of status. Admin-only at the route level. */
export async function setPackageFeatured(
  owner: string,
  name: string,
  featured: boolean
): Promise<{ id: string; featured: boolean }> {
  const db = requireDb();
  const row = await getDbPackageRow(db, owner, name);
  if (!row) throw new PackageActionError(404, `package not found: ${owner}/${name}`);

  await db
    .update(packages)
    .set({ featured, updatedAt: new Date() })
    .where(eq(packages.id, row.id));

  return { id: `${owner}/${name}`, featured };
}

/**
 * Deletes a DB-backed package outright — only when it has zero purchase rows
 * (else 409; the caller should unlist instead). `package_versions` and
 * `package_files` cascade via their FK to `packages.id`; `package_stats` and
 * `stars` are keyed by (owner, name) text with no FK, so they're deleted here
 * explicitly. `reports`/`reviews` are also (owner, name)-keyed but are
 * deliberately left in place — they're a moderation record of what happened,
 * not package state.
 */
export async function deletePackage(owner: string, name: string): Promise<{ id: string; deleted: true }> {
  const db = requireDb();
  const row = await getDbPackageRow(db, owner, name);
  if (!row) throw new PackageActionError(404, `package not found: ${owner}/${name}`);

  const [existingPurchase] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.packageId, row.id))
    .limit(1);
  if (existingPurchase) {
    throw new PackageActionError(409, "package has purchases; unlist it instead");
  }

  await db.delete(packages).where(eq(packages.id, row.id));
  await db
    .delete(packageStats)
    .where(and(eq(packageStats.owner, owner), eq(packageStats.name, name)));
  await db.delete(stars).where(and(eq(stars.owner, owner), eq(stars.name, name)));

  return { id: `${owner}/${name}`, deleted: true };
}

/**
 * Whether `owner/name` has at least one purchase row — the same check
 * `deletePackage` itself enforces, exposed separately so the package page can
 * disable the Delete button (with an explanatory tooltip) before the owner
 * ever tries and gets a 409. `false` for a seed package (no DB row, hence no
 * purchases to find) or with no database configured — deletion isn't
 * available in either case anyway.
 */
export async function packageHasPurchases(owner: string, name: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  try {
    const row = await getDbPackageRow(db, owner, name);
    if (!row) return false;

    const [existing] = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.packageId, row.id))
      .limit(1);
    return Boolean(existing);
  } catch {
    // A DB error must not take the package page down. Answer "yes" so the only
    // thing it affects — the owner's Delete button — stays disabled until the
    // database can actually be asked.
    return true;
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface CreateReportArgs {
  owner: string;
  name: string;
  reason: string;
  details?: string;
  /** Null for an anonymous report. */
  reporterUserId?: string | null;
}

export async function createReport(args: CreateReportArgs): Promise<{ id: string }> {
  if (!isValidReportReason(args.reason)) {
    throw new PackageActionError(400, `reason must be one of: ${REPORT_REASONS.join(", ")}`);
  }

  let details: string | undefined;
  if (args.details !== undefined) {
    if (args.details.length > MAX_DETAILS_CHARS) {
      throw new PackageActionError(400, `details must be ${MAX_DETAILS_CHARS} characters or fewer`);
    }
    details = args.details.trim() || undefined;
  }

  const db = requireDb();

  // A report doesn't require a DB row for the package — seed packages are
  // reportable too — but it must exist somewhere in the catalog.
  const catalog = await getCatalog();
  const pkg = await catalog.get(args.owner, args.name);
  if (!pkg) throw new PackageActionError(404, `package not found: ${args.owner}/${args.name}`);

  const [row] = await db
    .insert(reports)
    .values({
      owner: args.owner,
      name: args.name,
      reporterUserId: args.reporterUserId ?? null,
      reason: args.reason,
      details,
    })
    .returning({ id: reports.id });

  return { id: row.id };
}

export async function resolveReport(
  id: string,
  status: string
): Promise<{ id: string; status: "resolved" | "dismissed" }> {
  if (status !== "resolved" && status !== "dismissed") {
    throw new PackageActionError(400, `status must be "resolved" or "dismissed"`);
  }

  const db = requireDb();
  const [row] = await db
    .update(reports)
    .set({ status })
    .where(eq(reports.id, id))
    .returning({ id: reports.id });
  if (!row) throw new PackageActionError(404, `report not found: ${id}`);

  return { id: row.id, status };
}

// ---------------------------------------------------------------------------
// Admin queue
// ---------------------------------------------------------------------------

export interface QueuePackage {
  id: string;
  owner: string;
  name: string;
  title: string;
  status: PackageStatus;
  createdAt: string;
}

export interface QueueReport {
  id: string;
  owner: string;
  name: string;
  reason: string;
  details?: string;
  status: string;
  createdAt: string;
}

export interface ModerationQueue {
  pending: QueuePackage[];
  reports: QueueReport[];
}

/** Pending packages plus open reports, for the `/admin` page and `GET
 *  /api/v1/admin/queue`. Admin-only at the caller level. */
export async function listQueue(): Promise<ModerationQueue> {
  const db = requireDb();
  const [pendingRows, reportRows] = await Promise.all([
    db.select().from(packages).where(eq(packages.status, "pending")),
    db.select().from(reports).where(eq(reports.status, "open")),
  ]);

  return {
    pending: pendingRows
      .map((r) => ({
        id: `${r.owner}/${r.name}`,
        owner: r.owner,
        name: r.name,
        title: r.title,
        status: r.status as PackageStatus,
        createdAt: r.createdAt.toISOString(),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    reports: reportRows
      .map((r) => ({
        id: r.id,
        owner: r.owner,
        name: r.name,
        reason: r.reason,
        details: r.details ?? undefined,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
