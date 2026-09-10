import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { error, json, preflight } from "@/lib/api";
import { getCreatorTotals } from "@/lib/stats";

export const runtime = "nodejs";

// GET /api/v1/users/[handle] — public profile: bio, website, avatar, package
// count, and totals across every package they've published. Works for seed
// catalog owners (no `users` row at all) via `catalog.creator`, same as
// `/u/[handle]` does.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;

  const catalog = await getCatalog();
  const creator = await catalog.creator(handle);
  if (!creator) {
    return error(404, `user not found: ${handle}`);
  }

  // `catalog.creator` doesn't surface `users.website` (only a seed owner's
  // `owner.json` "url"), so read it here for DB-backed users. Falls back to
  // the seed-derived `creator.url` so seed owners still get a link.
  let website: string | null = creator.url ?? null;
  const db = getDb();
  if (db) {
    try {
      const [row] = await db.select({ website: users.website }).from(users).where(eq(users.handle, handle)).limit(1);
      if (row?.website) website = row.website;
    } catch {
      // Fall back to whatever the seed catalog provided.
    }
  }

  const totals = await getCreatorTotals(handle);

  return json({
    handle: creator.handle,
    displayName: creator.displayName,
    bio: creator.bio ?? null,
    website,
    avatarUrl: creator.avatarUrl ?? null,
    packageCount: creator.packageCount,
    totals: { stars: totals.stars, downloads: totals.downloads },
  });
}

export async function OPTIONS() {
  return preflight();
}
