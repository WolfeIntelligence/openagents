// Collections: user-curated, ordered lists of packages (BATCH 3 / Y2, audit
// finding G-C3). Mirrors the zero-env-safe convention used across the app —
// every DB-backed function here returns an empty/null result instead of
// throwing when `DATABASE_URL` is unset, so `/collections` and `/c/*` still
// render (as an empty/"not configured" state) with no database.
//
// The pure helpers at the top (`deriveSlug`, `normalizePositions`,
// `nextPosition`, `buildInstallAllCommand`) have no Next.js/DB imports on
// purpose, so they can be unit tested with plain `node --test` — see
// `./__tests__/collections.test.ts`.

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collections, collectionItems } from "@/lib/db/schema";
import { getCatalog } from "@/lib/catalog";
import { absoluteUrl } from "@/lib/site";
import type { Requester } from "@/lib/requester";

export const COLLECTION_SLUG_PATTERN = /^[a-z0-9-]{2,64}$/;
export const MAX_COLLECTION_ITEMS = 100;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface CollectionSummary {
  id: string;
  owner: string;
  slug: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  featured: boolean;
  itemCount: number;
  updatedAt: string;
  url: string;
}

export interface CollectionItemRow {
  owner: string;
  name: string;
  position: number;
  note: string | null;
  addedAt: string;
}

export interface CollectionDetail extends CollectionSummary {
  ownerUserId: string;
  items: CollectionItemRow[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Lowercases `title`, collapses every run of non `[a-z0-9]` characters into a
 * single `-`, trims leading/trailing dashes, and truncates to 64 chars —
 * matches `COLLECTION_SLUG_PATTERN`. Falls back to a generic slug when the
 * title has no usable characters (e.g. "＠＠＠" or "").
 */
export function deriveSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (slug.length >= 2) return slug;
  if (slug.length === 1) return `${slug}-collection`;
  return "collection";
}

/** True when `slug` matches `COLLECTION_SLUG_PATTERN`. */
export function isValidSlug(slug: string): boolean {
  return COLLECTION_SLUG_PATTERN.test(slug);
}

/**
 * Sorts `items` by `position` (stable — equal positions keep their input
 * order) and reassigns contiguous positions `0..n-1` in that order. Use this
 * after a removal or a reorder so gaps and duplicate positions never survive
 * into storage or into the UI.
 */
export function normalizePositions<T extends { position: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.position - b.item.position || a.index - b.index)
    .map(({ item }, position) => ({ ...item, position }));
}

/** One past the highest existing position, or 0 for an empty collection — the
 *  slot a newly-added item lands in when no explicit position is given. */
export function nextPosition(items: readonly { position: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.position + 1), 0);
}

/**
 * The line an owner copies to install every package in a collection, in
 * order: one `npx <cli> add <owner>/<name>` per package (the CLI's `add`
 * command only takes one spec at a time — see `cli/bin/openagents.js`),
 * chained with `&&` so it still pastes as a single line. Empty string for an
 * empty collection.
 */
export function buildInstallAllCommand(
  items: readonly { owner: string; name: string }[],
  cli: string
): string {
  return items.map((item) => `npx ${cli} add ${item.owner}/${item.name}`).join(" && ");
}

// ---------------------------------------------------------------------------
// DB-backed reads/writes
// ---------------------------------------------------------------------------

type CollectionRow = typeof collections.$inferSelect;

/** True for a Postgres unique-violation error surfaced by the Neon driver (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "23505");
}

function toSummary(row: CollectionRow, itemCount: number): CollectionSummary {
  return {
    id: row.id,
    owner: row.ownerHandle,
    slug: row.slug,
    title: row.title,
    description: row.description,
    isPublic: row.isPublic,
    featured: row.featured,
    itemCount,
    updatedAt: row.updatedAt.toISOString(),
    url: absoluteUrl(`/c/${row.ownerHandle}/${row.slug}`),
  };
}

async function getItemCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const db = getDb();
  if (!db || ids.length === 0) return out;

  const rows = await db
    .select({ collectionId: collectionItems.collectionId, count: sql<number>`count(*)::int` })
    .from(collectionItems)
    .where(inArray(collectionItems.collectionId, ids))
    .groupBy(collectionItems.collectionId);

  for (const row of rows) out.set(row.collectionId, row.count);
  return out;
}

export interface ListCollectionsOptions {
  /** Filter to featured collections only. */
  featured?: boolean;
  /** Filter to one owner's handle. */
  owner?: string;
  /** The caller's user id — when it matches the owner of the collections being
   *  listed, that caller's private collections are included too. */
  callerId?: string;
  /** Case-insensitive substring match on title. */
  q?: string;
  /** Admin-only escape hatch: skip the public/own-private visibility filter
   *  entirely (used by the "Featured collections" admin listing, which needs
   *  to see and toggle private collections too). Never set this from a
   *  caller-facing route without an `isAdmin` check first. */
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Public collections, plus the caller's own private ones when `owner` is the
 * caller (see the route contract in `/api/v1/collections`). Ordered featured
 * first, then most recently updated. Returns an empty page (not a throw) on
 * any DB error or when the DB is off.
 */
export async function listCollections(
  opts: ListCollectionsOptions
): Promise<{ items: CollectionSummary[]; total: number }> {
  const db = getDb();
  if (!db) return { items: [], total: 0 };

  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(opts.offset ?? 0, 0);

  const visibility =
    opts.owner && opts.callerId
      ? or(eq(collections.isPublic, true), eq(collections.ownerUserId, opts.callerId))
      : eq(collections.isPublic, true);

  const conditions = opts.includePrivate ? [] : [visibility];
  if (opts.owner) conditions.push(eq(collections.ownerHandle, opts.owner));
  if (opts.featured) conditions.push(eq(collections.featured, true));
  if (opts.q) conditions.push(ilike(collections.title, `%${opts.q}%`));
  const where = and(...conditions);

  try {
    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(collections)
        .where(where)
        .orderBy(desc(collections.featured), desc(collections.updatedAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(collections).where(where),
    ]);

    const counts = await getItemCounts(rows.map((r) => r.id));
    return {
      items: rows.map((r) => toSummary(r, counts.get(r.id) ?? 0)),
      total: countRows[0]?.count ?? 0,
    };
  } catch {
    return { items: [], total: 0 };
  }
}

/** Public collections for one owner, newest-updated first — for the creator
 *  page (`/u/[handle]`, owned elsewhere; see the "Needs change elsewhere"
 *  note in the implementation report for the 3-line addition it needs). */
export async function listCollectionsForOwner(handle: string, limit = 20): Promise<CollectionSummary[]> {
  const { items } = await listCollections({ owner: handle, limit });
  return items;
}

/** One collection with its ordered items, or null if it doesn't exist or the
 *  DB is off. Does not itself enforce visibility — callers (routes/pages)
 *  decide whether a private result should be shown to this viewer. */
export async function getCollection(handle: string, slug: string): Promise<CollectionDetail | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const [row] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.ownerHandle, handle), eq(collections.slug, slug)))
      .limit(1);
    if (!row) return null;

    const itemRows = await db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, row.id))
      .orderBy(asc(collectionItems.position));

    const items: CollectionItemRow[] = itemRows.map((i) => ({
      owner: i.owner,
      name: i.name,
      position: i.position,
      note: i.note,
      addedAt: i.addedAt.toISOString(),
    }));

    return { ...toSummary(row, items.length), ownerUserId: row.ownerUserId, items };
  } catch {
    return null;
  }
}

export type CreateCollectionResult =
  | { ok: true; collection: CollectionSummary }
  | { ok: false; status: number; message: string };

/** Creates a collection owned by `requester`. Derives a slug from `title`
 *  when none is given; 409s (via the `ok: false` result) on a duplicate
 *  `(ownerHandle, slug)` — the DB's unique constraint is the actual guard,
 *  this just turns its error into the route's response shape. */
export async function createCollection(
  requester: Requester,
  input: { title: string; slug?: string; description?: string | null; isPublic?: boolean }
): Promise<CreateCollectionResult> {
  const db = getDb();
  if (!db) {
    return { ok: false, status: 503, message: "collections require a database; none is configured on this deployment" };
  }
  if (!requester.handle) {
    return { ok: false, status: 400, message: "set a handle before creating a collection" };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, status: 400, message: "title is required" };

  const slug = input.slug?.trim().toLowerCase() || deriveSlug(title);
  if (!isValidSlug(slug)) {
    return { ok: false, status: 400, message: "slug must match ^[a-z0-9-]{2,64}$" };
  }

  try {
    const [row] = await db
      .insert(collections)
      .values({
        ownerUserId: requester.id,
        ownerHandle: requester.handle,
        slug,
        title,
        description: input.description?.trim() || null,
        isPublic: input.isPublic ?? true,
      })
      .returning();
    return { ok: true, collection: toSummary(row, 0) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, message: `a collection with slug "${slug}" already exists` };
    }
    return { ok: false, status: 500, message: "failed to create collection" };
  }
}

export interface CollectionPatch {
  title?: string;
  description?: string | null;
  isPublic?: boolean;
  featured?: boolean;
  slug?: string;
}

/** Updates a collection's own fields (not its items). Returns `"conflict"` on
 *  a duplicate slug, `null` on any other failure (including "doesn't exist"
 *  — callers should have already confirmed existence via `getCollection`). */
export async function updateCollection(
  id: string,
  patch: CollectionPatch
): Promise<CollectionSummary | null | "conflict"> {
  const db = getDb();
  if (!db) return null;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.isPublic !== undefined) set.isPublic = patch.isPublic;
  if (patch.featured !== undefined) set.featured = patch.featured;
  if (patch.slug !== undefined) set.slug = patch.slug;

  try {
    const [row] = await db.update(collections).set(set).where(eq(collections.id, id)).returning();
    if (!row) return null;
    const counts = await getItemCounts([row.id]);
    return toSummary(row, counts.get(row.id) ?? 0);
  } catch (err) {
    if (isUniqueViolation(err)) return "conflict";
    return null;
  }
}

/** True when a row was actually deleted. Cascades to `collection_items` via
 *  the FK's `onDelete: "cascade"`. */
export async function deleteCollection(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const rows = await db.delete(collections).where(eq(collections.id, id)).returning({ id: collections.id });
    return rows.length > 0;
  } catch {
    return false;
  }
}

export type UpsertItemResult =
  | { ok: true; items: CollectionItemRow[] }
  | { ok: false; status: number; message: string };

/** Adds a package to a collection, or updates its note/position if it's
 *  already in there. 404s when the package doesn't exist in the catalog,
 *  400s past `MAX_COLLECTION_ITEMS` for a genuinely new item. */
export async function upsertItem(
  collectionId: string,
  input: { owner: string; name: string; note?: string | null; position?: number }
): Promise<UpsertItemResult> {
  const db = getDb();
  if (!db) {
    return { ok: false, status: 503, message: "collections require a database; none is configured on this deployment" };
  }

  const catalog = await getCatalog();
  const pkg = await catalog.get(input.owner, input.name);
  if (!pkg) {
    return { ok: false, status: 404, message: `package not found: ${input.owner}/${input.name}` };
  }

  try {
    const existing = await db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, collectionId))
      .orderBy(asc(collectionItems.position));

    const current = existing.find((i) => i.owner === input.owner && i.name === input.name);
    if (!current && existing.length >= MAX_COLLECTION_ITEMS) {
      return { ok: false, status: 400, message: `a collection can hold at most ${MAX_COLLECTION_ITEMS} packages` };
    }

    const position = input.position ?? current?.position ?? nextPosition(existing);

    await db
      .insert(collectionItems)
      .values({ collectionId, owner: input.owner, name: input.name, note: input.note ?? null, position })
      .onConflictDoUpdate({
        target: [collectionItems.collectionId, collectionItems.owner, collectionItems.name],
        set: { note: input.note ?? null, position },
      });

    await db.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId));

    const rows = await db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, collectionId))
      .orderBy(asc(collectionItems.position));

    return {
      ok: true,
      items: rows.map((i) => ({
        owner: i.owner,
        name: i.name,
        position: i.position,
        note: i.note,
        addedAt: i.addedAt.toISOString(),
      })),
    };
  } catch {
    return { ok: false, status: 500, message: "failed to update the collection" };
  }
}

/** True when an item was actually removed. */
export async function removeItem(collectionId: string, owner: string, name: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const rows = await db
      .delete(collectionItems)
      .where(
        and(
          eq(collectionItems.collectionId, collectionId),
          eq(collectionItems.owner, owner),
          eq(collectionItems.name, name)
        )
      )
      .returning({ owner: collectionItems.owner });
    if (rows.length > 0) {
      await db.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId));
    }
    return rows.length > 0;
  } catch {
    return false;
  }
}
