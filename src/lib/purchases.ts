// Purchase lookups shared by the package detail page and the download route.
// Safe to import with zero env vars — every export here degrades to `false`/`null`
// when the DB is disabled.

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packages, purchases } from "@/lib/db/schema";

/** True when `userId` has a `paid` purchase of the `owner/name` package. Always false
 *  when the DB is disabled or the package isn't DB-backed (seed packages can't be
 *  purchased, but are always free anyway). */
export async function hasPurchased(
  userId: string,
  owner: string,
  name: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const [dbPackage] = await db
    .select({ id: packages.id })
    .from(packages)
    .where(and(eq(packages.owner, owner), eq(packages.name, name)))
    .limit(1);
  if (!dbPackage) return false;

  const [purchase] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.packageId, dbPackage.id),
        eq(purchases.status, "paid")
      )
    )
    .limit(1);
  return Boolean(purchase);
}
