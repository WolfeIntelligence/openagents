import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { packages, purchases, stars } from "@/lib/db/schema";
import { DangerZone } from "@/components/DangerZone";

export const metadata: Metadata = {
  title: "Account",
  description: "Export your data or delete your OpenAgents account.",
};

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/settings/account");
  }

  if (!isDbEnabled()) {
    return (
      <PageShell>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-fg-muted">Account management is not configured on this deployment.</p>
          <p className="mt-2 text-xs text-fg-subtle">
            Set <code className="font-mono">DATABASE_URL</code> — see{" "}
            <code className="font-mono">docs/SETUP.md</code>.
          </p>
        </div>
      </PageShell>
    );
  }

  const db = getDb();
  if (!db) {
    return (
      <PageShell>
        <p className="text-sm text-fg-muted">We couldn&apos;t reach the database. Try again shortly.</p>
      </PageShell>
    );
  }

  const handle = session.user.handle;

  const [[packageCount], [purchaseCount], [starCount]] = await Promise.all([
    handle
      ? db.select({ count: sql<number>`count(*)::int` }).from(packages).where(eq(packages.owner, handle))
      : Promise.resolve([{ count: 0 }]),
    db.select({ count: sql<number>`count(*)::int` }).from(purchases).where(eq(purchases.userId, session.user.id)),
    db.select({ count: sql<number>`count(*)::int` }).from(stars).where(eq(stars.userId, session.user.id)),
  ]);

  return (
    <PageShell>
      <div className="rounded-lg border border-border p-5">
        <h2 className="text-base font-semibold text-fg">Export your data</h2>
        <p className="mt-1.5 max-w-xl text-sm text-fg-muted">
          Downloads a JSON file with your profile, the packages you own, your purchases,
          stars, reviews, and API token metadata (never the token secrets themselves).
        </p>
        <Link
          href="/api/v1/account/export"
          prefetch={false}
          className="mt-4 inline-flex w-fit items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-border-strong"
        >
          Download my data
        </Link>
      </div>

      <div className="mt-8">
        {handle ? (
          <DangerZone
            handle={handle}
            summary={{
              packages: packageCount?.count ?? 0,
              purchases: purchaseCount?.count ?? 0,
              stars: starCount?.count ?? 0,
            }}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-fg-muted">
              Your account has no handle yet, so it can&apos;t be safely confirmed for deletion here.
            </p>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Account</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Export everything OpenAgents has on file for you, or permanently delete your account.
      </p>
      {children}
    </div>
  );
}
