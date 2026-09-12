import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { formatPrice } from "@/lib/format";
import { Sparkline } from "@/components/Sparkline";
import { AdminStatCard } from "@/components/AdminStatCard";
import { getAdminAnalytics } from "./data";
import { WeeklyBars } from "./WeeklyBars";

export const metadata: Metadata = {
  title: "Admin analytics",
  description: "Site-wide totals, revenue, growth, and top packages (Z5).",
};

// /admin/analytics — 404 for anyone who isn't an admin, same as /admin itself.
export default async function AdminAnalyticsPage() {
  const requester = await getRequester();
  if (!(await isAdmin(requester))) notFound();

  if (!isDbEnabled()) {
    return (
      <PageShell>
        <p className="text-sm text-fg-muted">
          Analytics requires a database, which isn&apos;t configured on this deployment.
        </p>
      </PageShell>
    );
  }

  const analytics = await getAdminAnalytics(30);
  if (!analytics) {
    return (
      <PageShell>
        <p className="text-sm text-fg-muted">Analytics are temporarily unavailable — try again shortly.</p>
      </PageShell>
    );
  }

  const { totals, revenueLast30, topPackages, signupsPerWeek, installsPerDay } = analytics;
  const currencies = Object.keys(revenueLast30.grossByCurrency);

  return (
    <PageShell>
      <Section title="Totals">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <AdminStatCard label="Users" value={totals.users.toLocaleString()} />
          <AdminStatCard label="Live packages" value={(totals.packagesByStatus.live ?? 0).toLocaleString()} />
          <AdminStatCard label="Pending review" value={totals.pendingPackages.toLocaleString()} />
          <AdminStatCard label="Open reports" value={totals.openReports.toLocaleString()} />
          <AdminStatCard label="Installs (7d)" value={totals.installsLast7.toLocaleString()} />
          <AdminStatCard label="Installs (30d)" value={totals.installsLast30.toLocaleString()} />
          <AdminStatCard label="Stars" value={totals.stars.toLocaleString()} />
          <AdminStatCard label="Reviews" value={totals.reviews.toLocaleString()} />
          {totals.openRefundRequests !== null && (
            <AdminStatCard label="Open refund requests" value={totals.openRefundRequests.toLocaleString()} />
          )}
        </div>
      </Section>

      <Section title="Revenue (last 30 days)">
        {currencies.length === 0 ? (
          <p className="text-sm text-fg-muted">No paid purchases in the last 30 days.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <AdminStatCard label="Purchases" value={revenueLast30.count.toLocaleString()} />
            {currencies.map((currency) => (
              <AdminStatCard
                key={currency}
                label={`Gross (${currency.toUpperCase()})`}
                value={formatPrice(revenueLast30.grossByCurrency[currency], currency)}
                sublabel={`Net ${formatPrice(revenueLast30.netByCurrency[currency] ?? 0, currency)}`}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Installs per day (30d)">
        <div className="max-w-xl text-accent">
          <Sparkline data={installsPerDay} label="Site-wide installs" height={60} />
        </div>
      </Section>

      <Section title="Signups per week (12w)">
        <div className="max-w-xl text-accent">
          <WeeklyBars data={signupsPerWeek} />
        </div>
      </Section>

      <Section title="Top packages (30-day installs)">
        {topPackages.length === 0 ? (
          <p className="text-sm text-fg-muted">No installs recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {topPackages.map((p, i) => (
              <li
                key={`${p.owner}/${p.name}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <span className="mr-2 text-xs text-fg-subtle">{i + 1}.</span>
                  <Link
                    href={`/p/${p.owner}/${p.name}`}
                    className="font-mono text-sm text-accent hover:text-accent-hover"
                  >
                    {p.owner}/{p.name}
                  </Link>
                  <p className="ml-5 text-xs text-fg-subtle">{p.title}</p>
                </div>
                <span className="shrink-0 text-sm font-medium text-fg">{p.installs.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-fg">Analytics</h1>
        <Link href="/admin" className="text-sm text-accent hover:text-accent-hover">
          Back to admin
        </Link>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Site-wide totals, revenue, growth, and top packages.
      </p>
      <div className="mt-8 flex flex-col gap-10">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
