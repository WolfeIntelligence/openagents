// Security advisories (Z2): admin-posted notices attached to a package, shown on
// the package page (`AdvisoryBanner`), returned by the package detail and
// advisories APIs, and surfaced by the CLI at install time. Backed by the
// `advisories` table (schema.ts) — one row per advisory, "withdrawn" via
// `withdrawnAt` rather than deletion so the history stays auditable.
//
// The range-matching logic (`affectsVersion` and everything it calls) is pure
// and has no DB dependency — it's unit-tested directly in
// `./__tests__/advisories.test.ts`. `src/lib/semver.ts` only compares two full
// versions against each other and has no notion of a *range*, so the minimal
// `<`, `<=`, `>=`, `>`, `=`, `^`, `~`, `*` matcher below is implemented here
// rather than there.

import { and, desc, eq } from "drizzle-orm";
import { getCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db/client";
import { advisories } from "@/lib/db/schema";
import { compareSemver, SemverError } from "@/lib/semver";

export const ADVISORY_SEVERITIES = ["low", "moderate", "high", "critical"] as const;
export type AdvisorySeverity = (typeof ADVISORY_SEVERITIES)[number];

export function isValidAdvisorySeverity(value: string): value is AdvisorySeverity {
  return (ADVISORY_SEVERITIES as readonly string[]).includes(value);
}

export interface Advisory {
  id: string;
  owner: string;
  name: string;
  severity: AdvisorySeverity;
  title: string;
  body: string;
  /** semver range of affected versions, e.g. "<1.3.0"; null = every version. */
  affectedVersions: string | null;
  fixedInVersion: string | null;
  createdAt: string; // ISO
  withdrawnAt: string | null; // ISO, or null if still active
}

type AdvisoryRow = typeof advisories.$inferSelect;

function toAdvisory(row: AdvisoryRow): Advisory {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    severity: row.severity as AdvisorySeverity,
    title: row.title,
    body: row.body,
    affectedVersions: row.affectedVersions,
    fixedInVersion: row.fixedInVersion,
    createdAt: row.createdAt.toISOString(),
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Range matching — pure, no DB.
// ---------------------------------------------------------------------------

type RangeOp = "=" | "<" | "<=" | ">" | ">=";

interface Comparator {
  op: RangeOp;
  version: string;
}

/** Parses "X.Y.Z" into numeric [major, minor, patch], ignoring any
 *  prerelease/build suffix — only used to compute caret/tilde boundaries,
 *  which are defined purely in terms of the numeric triple. */
function numericTriple(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) throw new SemverError(version);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** One range token ("^1.2.3", "~1.2.3", ">=1.0.0", "1.2.3", "*") into the
 *  comparator(s) it expands to. Multiple tokens in a range are ANDed
 *  together by `affectsVersion` (the same convention as npm's space-separated
 *  range syntax, without the "||" OR or hyphen-range extensions — a minimal
 *  matcher per the contract, not a full semver-range implementation). */
function parseToken(token: string): Comparator[] {
  const t = token.trim();
  if (t === "" || t === "*") return [];

  if (t.startsWith("^")) {
    const version = t.slice(1);
    const [major, minor, patch] = numericTriple(version);
    const upper = major > 0 ? `${major + 1}.0.0` : minor > 0 ? `0.${minor + 1}.0` : `0.0.${patch + 1}`;
    return [
      { op: ">=", version },
      { op: "<", version: upper },
    ];
  }

  if (t.startsWith("~")) {
    const version = t.slice(1);
    const [major, minor] = numericTriple(version);
    return [
      { op: ">=", version },
      { op: "<", version: `${major}.${minor + 1}.0` },
    ];
  }

  for (const op of [">=", "<=", ">", "<", "="] as const) {
    if (t.startsWith(op)) {
      return [{ op, version: t.slice(op.length).trim() }];
    }
  }

  // A bare version ("1.2.3") means exact equality.
  return [{ op: "=", version: t }];
}

function comparatorHolds(version: string, comparator: Comparator): boolean {
  const cmp = compareSemver(version, comparator.version);
  switch (comparator.op) {
    case "=":
      return cmp === 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
  }
}

/**
 * Whether `version` falls inside `advisory.affectedVersions`. A null/empty/"*"
 * range affects every version. An unparsable range (an admin typo, most
 * likely) fails open — the advisory is shown rather than silently hidden —
 * since the cost of an occasional over-broad warning is far lower than the
 * cost of a real security notice vanishing because of a malformed range.
 */
export function affectsVersion(advisory: { affectedVersions?: string | null }, version: string): boolean {
  const range = advisory.affectedVersions?.trim();
  if (!range) return true;

  try {
    const tokens = range.split(/\s+/);
    for (const token of tokens) {
      for (const comparator of parseToken(token)) {
        if (!comparatorHolds(version, comparator)) return false;
      }
    }
    return true;
  } catch (err) {
    if (err instanceof SemverError) return true; // fail open — see doc comment above
    throw err;
  }
}

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

export class AdvisoryError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdvisoryError";
    this.status = status;
  }
}

type Db = NonNullable<ReturnType<typeof getDb>>;

function requireDb(): Db {
  const db = getDb();
  if (!db) throw new AdvisoryError(503, "advisories require a database; none is configured on this deployment");
  return db;
}

/** Every advisory for `owner/name`, active ones first (then newest first
 *  within each group) — the shape `GET /api/v1/packages/{o}/{n}/advisories`
 *  returns. Empty (not an error) with no database configured. */
export async function listAdvisoriesForPackage(owner: string, name: string): Promise<Advisory[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(advisories)
    .where(and(eq(advisories.owner, owner), eq(advisories.name, name)));

  return rows
    .map(toAdvisory)
    .sort((a, b) => {
      const aActive = a.withdrawnAt === null;
      const bActive = b.withdrawnAt === null;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

/** Active (non-withdrawn) advisories for `owner/name`, newest first — what the
 *  package page's `AdvisoryBanner` and the package detail API's `advisories`
 *  field show. Empty (not an error) with no database configured. */
export async function activeAdvisories(owner: string, name: string): Promise<Advisory[]> {
  const all = await listAdvisoriesForPackage(owner, name);
  return all.filter((a) => a.withdrawnAt === null);
}

const RECENT_ADVISORIES_LIMIT = 100;

/** Most recently created advisories across every package (active and
 *  withdrawn), newest first — backs the admin "Advisories" section, which
 *  needs to see (and withdraw) advisories for any package, not just one.
 *  Empty (not an error) with no database configured. */
export async function listRecentAdvisories(): Promise<Advisory[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(advisories)
    .orderBy(desc(advisories.createdAt))
    .limit(RECENT_ADVISORIES_LIMIT);

  return rows.map(toAdvisory);
}

const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 4000;

function validateRangeField(label: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AdvisoryError(400, `"${label}" must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

export interface CreateAdvisoryArgs {
  owner: string;
  name: string;
  severity: string;
  title: string;
  body: string;
  affectedVersions?: string;
  fixedInVersion?: string;
  createdByUserId?: string | null;
}

/** Admin-only at the route level. Verifies the package exists (seed or DB —
 *  same catalog every other package-scoped write checks against) before
 *  inserting. */
export async function createAdvisory(args: CreateAdvisoryArgs): Promise<Advisory> {
  if (!isValidAdvisorySeverity(args.severity)) {
    throw new AdvisoryError(400, `severity must be one of: ${ADVISORY_SEVERITIES.join(", ")}`);
  }
  const title = args.title?.trim();
  if (!title) throw new AdvisoryError(400, `"title" is required`);
  if (title.length > MAX_TITLE_CHARS) {
    throw new AdvisoryError(400, `title must be ${MAX_TITLE_CHARS} characters or fewer`);
  }
  const body = args.body?.trim();
  if (!body) throw new AdvisoryError(400, `"body" is required`);
  if (body.length > MAX_BODY_CHARS) {
    throw new AdvisoryError(400, `body must be ${MAX_BODY_CHARS} characters or fewer`);
  }
  const affectedVersions = validateRangeField("affectedVersions", args.affectedVersions);
  const fixedInVersion = validateRangeField("fixedInVersion", args.fixedInVersion);

  const db = requireDb();

  const catalog = await getCatalog();
  const pkg = await catalog.get(args.owner, args.name);
  if (!pkg) throw new AdvisoryError(404, `package not found: ${args.owner}/${args.name}`);

  const [row] = await db
    .insert(advisories)
    .values({
      owner: args.owner,
      name: args.name,
      severity: args.severity,
      title,
      body,
      affectedVersions: affectedVersions ?? null,
      fixedInVersion: fixedInVersion ?? null,
      createdByUserId: args.createdByUserId ?? null,
    })
    .returning();

  return toAdvisory(row);
}

export interface UpdateAdvisoryArgs {
  /** `true` withdraws it (sets `withdrawnAt`); `false` reopens a previously
   *  withdrawn advisory (clears it). Omit to leave withdrawal state alone. */
  withdrawn?: boolean;
  severity?: string;
  title?: string;
  body?: string;
  affectedVersions?: string | null;
  fixedInVersion?: string | null;
}

/** Admin-only at the route level. 404s for an unknown id. */
export async function updateAdvisory(id: string, args: UpdateAdvisoryArgs): Promise<Advisory> {
  const db = requireDb();

  const patch: Partial<AdvisoryRow> = {};

  if (args.severity !== undefined) {
    if (!isValidAdvisorySeverity(args.severity)) {
      throw new AdvisoryError(400, `severity must be one of: ${ADVISORY_SEVERITIES.join(", ")}`);
    }
    patch.severity = args.severity;
  }
  if (args.title !== undefined) {
    const title = args.title.trim();
    if (!title) throw new AdvisoryError(400, `"title" cannot be empty`);
    if (title.length > MAX_TITLE_CHARS) {
      throw new AdvisoryError(400, `title must be ${MAX_TITLE_CHARS} characters or fewer`);
    }
    patch.title = title;
  }
  if (args.body !== undefined) {
    const body = args.body.trim();
    if (!body) throw new AdvisoryError(400, `"body" cannot be empty`);
    if (body.length > MAX_BODY_CHARS) {
      throw new AdvisoryError(400, `body must be ${MAX_BODY_CHARS} characters or fewer`);
    }
    patch.body = body;
  }
  if (args.affectedVersions !== undefined) {
    patch.affectedVersions = args.affectedVersions?.trim() || null;
  }
  if (args.fixedInVersion !== undefined) {
    patch.fixedInVersion = args.fixedInVersion?.trim() || null;
  }
  if (args.withdrawn !== undefined) {
    patch.withdrawnAt = args.withdrawn ? new Date() : null;
  }

  if (Object.keys(patch).length === 0) {
    throw new AdvisoryError(400, "body must include at least one field to update");
  }

  const [row] = await db.update(advisories).set(patch).where(eq(advisories.id, id)).returning();
  if (!row) throw new AdvisoryError(404, `advisory not found: ${id}`);

  return toAdvisory(row);
}
