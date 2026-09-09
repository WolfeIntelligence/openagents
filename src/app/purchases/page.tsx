import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { packages, purchases } from "@/lib/db/schema";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = {
  title: "Purchases",
  description: "Packages you've purchased on OpenAgents.",
};

export default async function PurchasesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/purchases");
  }

  const dbEnabled = isDbEnabled();
  const db = getDb();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Purchases</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Paid packages you&apos;ve bought. Sign in with the same account to re-download anytime.
      </p>

      <div className="mt-6">
        {!dbEnabled || !db ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-fg-muted">
              Payments are not configured on this deployment.
            </p>
          </div>
        ) : (
          <PurchasesTable userId={session.user.id} db={db} />
        )}
      </div>
    </div>
  );
}

async function PurchasesTable({
  userId,
  db,
}: {
  userId: string;
  db: NonNullable<ReturnType<typeof getDb>>;
}) {
  const rows = await db
    .select({
      owner: packages.owner,
      name: packages.name,
      title: packages.title,
      amountCents: purchases.amountCents,
      currency: packages.currency,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .innerJoin(packages, eq(purchases.packageId, packages.id))
    .where(eq(purchases.userId, userId))
    .orderBy(desc(purchases.createdAt));

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No purchases yet"
        description="Packages you buy will show up here."
        action={
          <Link
            href="/explore"
            className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            Explore packages
          </Link>
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left">
            <th className="px-4 py-2 font-medium text-fg-muted">Package</th>
            <th className="px-4 py-2 font-medium text-fg-muted">Date</th>
            <th className="px-4 py-2 font-medium text-fg-muted">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="px-4 py-2">
                <Link
                  href={`/p/${row.owner}/${row.name}`}
                  className="font-mono text-accent hover:text-accent-hover"
                >
                  {row.owner}/{row.name}
                </Link>
                <span className="ml-2 text-fg-subtle">{row.title}</span>
              </td>
              <td className="px-4 py-2 text-fg-muted">
                {row.createdAt.toLocaleDateString()}
              </td>
              <td className="px-4 py-2 font-mono text-fg">
                {(row.amountCents / 100).toLocaleString(undefined, {
                  style: "currency",
                  currency: row.currency.toUpperCase(),
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
