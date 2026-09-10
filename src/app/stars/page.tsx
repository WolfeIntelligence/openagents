import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { stars } from "@/lib/db/schema";
import { getCatalog } from "@/lib/catalog";
import { toSummary, type PackageSummary } from "@/lib/types";
import { PackageCard } from "@/components/PackageCard";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";

export const metadata: Metadata = {
  title: "Starred packages",
  description: "Packages you've starred.",
};

const PAGE_SIZE = 24;

export default async function StarsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/stars");
  }

  const rawParams = await searchParams;
  const page = Math.max(1, Number(rawParams.page) || 1);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-xl font-semibold text-fg">Starred packages</h1>
      <p className="mt-1.5 text-sm text-fg-muted">Packages you&apos;ve starred, newest first.</p>

      <div className="mt-6">
        {!isDbEnabled() ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-fg-muted">
              Stars require a database, which isn&apos;t configured on this deployment.
            </p>
          </div>
        ) : (
          <StarredList userId={session.user.id} page={page} rawParams={rawParams} />
        )}
      </div>
    </div>
  );
}

async function StarredList({
  userId,
  page,
  rawParams,
}: {
  userId: string;
  page: number;
  rawParams: Record<string, string | string[] | undefined>;
}) {
  const db = getDb();
  if (!db) {
    return (
      <EmptyState
        title="No stars yet"
        description="Star a package from its page to see it here."
      />
    );
  }

  let starRows: { owner: string; name: string; createdAt: Date }[] = [];
  try {
    starRows = await db
      .select({ owner: stars.owner, name: stars.name, createdAt: stars.createdAt })
      .from(stars)
      .where(eq(stars.userId, userId))
      .orderBy(desc(stars.createdAt));
  } catch {
    // Table not migrated yet, or the DB is briefly unreachable — show an empty
    // state rather than a hard error.
  }

  if (starRows.length === 0) {
    return (
      <EmptyState
        title="No stars yet"
        description="Star a package from its page to see it here."
      />
    );
  }

  const total = starRows.length;
  const offset = (page - 1) * PAGE_SIZE;
  const pageRows = starRows.slice(offset, offset + PAGE_SIZE);

  const catalog = await getCatalog();
  const packages = (
    await Promise.all(pageRows.map((row) => catalog.get(row.owner, row.name)))
  ).filter((pkg): pkg is NonNullable<typeof pkg> => pkg !== null);
  const items: PackageSummary[] = packages.map(toSummary);

  return (
    <>
      <p className="mb-5 text-sm text-fg-muted">
        {total.toLocaleString()} package{total === 1 ? "" : "s"}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((pkg) => (
          <PackageCard key={pkg.id} pkg={pkg} />
        ))}
      </div>
      <div className="mt-8">
        <Pagination total={total} page={page} pageSize={PAGE_SIZE} searchParams={rawParams} basePath="/stars" />
      </div>
    </>
  );
}
