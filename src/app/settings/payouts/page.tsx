import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { getConnectedAccountStatus, isStripeEnabled, PLATFORM_FEE_BPS } from "@/lib/stripe";
import { packages, purchases, users } from "@/lib/db/schema";
import { ConnectStripeButton } from "@/components/ConnectStripeButton";
import { formatPrice } from "@/lib/format";
import { PurchaseStatusBadge } from "@/components/PurchaseStatusBadge";

export const metadata: Metadata = {
  title: "Payouts",
  description: "Manage your Stripe Connect payout account and view your sales.",
};

interface PayoutsPageProps {
  searchParams: Promise<{ connected?: string; refresh?: string }>;
}

interface SaleRow {
  id: string;
  owner: string;
  name: string;
  title: string;
  amountCents: number;
  // `purchases.currency` doesn't exist in the schema yet (see the payments-workstream
  // report's "Needs change elsewhere") — fall back to the package's current currency.
  currency: string;
  status: string;
  createdAt: Date;
}

/** Refunded/disputed/failed money never reached (or was clawed back from) the seller,
 *  so it's excluded from the totals below — the sales table still lists every row. */
const EXCLUDED_FROM_TOTALS = new Set(["refunded", "disputed", "failed"]);

export default async function PayoutsPage({ searchParams }: PayoutsPageProps) {
  const { connected, refresh } = await searchParams;

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/settings/payouts");
  }

  const dbEnabled = isDbEnabled();
  const stripeEnabled = isStripeEnabled();
  const db = getDb();

  if (!dbEnabled || !db || !stripeEnabled) {
    return (
      <PageShell>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-fg-muted">
            Payments are not configured on this deployment.
          </p>
          <p className="mt-2 text-xs text-fg-subtle">
            Set <code className="font-mono">DATABASE_URL</code> and{" "}
            <code className="font-mono">STRIPE_SECRET_KEY</code> — see{" "}
            <code className="font-mono">docs/SETUP.md</code>.
          </p>
        </div>
      </PageShell>
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user) {
    return (
      <PageShell>
        <p className="text-sm text-fg-muted">We couldn&apos;t find your account. Try signing in again.</p>
      </PageShell>
    );
  }

  // The webhook (v2 thin events for the recipient capability / requirements) is the
  // source of truth long-term, but it may not have arrived yet when Stripe bounces the
  // user straight back here — refresh eagerly so the page is accurate immediately after
  // onboarding completes.
  if (connected === "1" && user.stripeAccountId) {
    try {
      const status = await getConnectedAccountStatus(user.stripeAccountId);
      if (status.onboarded !== user.stripeOnboarded) {
        await db.update(users).set({ stripeOnboarded: status.onboarded }).where(eq(users.id, user.id));
        user.stripeOnboarded = status.onboarded;
      }
    } catch {
      // Stripe lookup failed — fall back to whatever's already in the DB.
    }
  }

  let sales: SaleRow[] = [];
  if (user.handle) {
    sales = await db
      .select({
        id: purchases.id,
        owner: packages.owner,
        name: packages.name,
        title: packages.title,
        amountCents: purchases.amountCents,
        currency: packages.currency,
        status: purchases.status,
        createdAt: purchases.createdAt,
      })
      .from(purchases)
      .innerJoin(packages, eq(purchases.packageId, packages.id))
      .where(eq(packages.owner, user.handle))
      .orderBy(desc(purchases.createdAt));
  }

  const creatorShare = (10000 - PLATFORM_FEE_BPS) / 10000;

  // Grouped by currency rather than a single total — a seller can price different
  // packages in different currencies, and summing raw minor units across currencies
  // would produce a meaningless number.
  const totalsByCurrency = new Map<string, { grossCents: number; count: number }>();
  for (const sale of sales) {
    if (EXCLUDED_FROM_TOTALS.has(sale.status)) continue;
    const totals = totalsByCurrency.get(sale.currency) ?? { grossCents: 0, count: 0 };
    totals.grossCents += sale.amountCents;
    totals.count += 1;
    totalsByCurrency.set(sale.currency, totals);
  }

  return (
    <PageShell>
      {connected === "1" && user.stripeOnboarded && (
        <Banner tone="accent">Stripe onboarding complete — payouts are active.</Banner>
      )}
      {refresh === "1" && (
        <Banner tone="warning">That onboarding link expired. Start again below.</Banner>
      )}

      <div className="mt-6 rounded-lg border border-border p-6">
        {!user.stripeAccountId ? (
          <NotConnected />
        ) : !user.stripeOnboarded ? (
          <NotOnboarded />
        ) : (
          <Onboarded accountId={user.stripeAccountId} />
        )}
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-fg">Your sales</h2>
        {sales.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">
            No paid packages sold yet.
          </p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface text-left">
                    <th className="px-4 py-2 font-medium text-fg-muted">Package</th>
                    <th className="px-4 py-2 font-medium text-fg-muted">Date</th>
                    <th className="px-4 py-2 font-medium text-fg-muted">Amount</th>
                    <th className="px-4 py-2 font-medium text-fg-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        <Link
                          href={`/p/${s.owner}/${s.name}`}
                          className="font-mono text-accent hover:text-accent-hover"
                        >
                          {s.owner}/{s.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-fg-muted">{s.createdAt.toLocaleDateString()}</td>
                      <td className="px-4 py-2 font-mono text-fg">{formatPrice(s.amountCents, s.currency)}</td>
                      <td className="px-4 py-2">
                        <PurchaseStatusBadge status={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-col gap-1 text-sm text-fg-muted">
              {Array.from(totalsByCurrency.entries()).map(([currency, totals]) => (
                <p key={currency}>
                  Total: <span className="font-mono text-fg">{formatPrice(totals.grossCents, currency)}</span>{" "}
                  gross,{" "}
                  <span className="font-mono text-fg">
                    {formatPrice(Math.round(totals.grossCents * creatorShare), currency)}
                  </span>{" "}
                  net across {totals.count.toLocaleString()} sale(s).
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Payouts</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Manage the Stripe Express account that receives your share of paid package sales.
      </p>
      {children}
    </div>
  );
}

function Banner({ tone, children }: { tone: "accent" | "warning"; children: ReactNode }) {
  const toneClasses =
    tone === "accent"
      ? "border-accent-border bg-accent-muted text-fg"
      : "border-warning/40 bg-warning/10 text-fg";
  return (
    <div className={`mt-6 rounded-lg border p-4 text-sm ${toneClasses}`}>{children}</div>
  );
}

function NotConnected() {
  return (
    <div>
      <h2 className="text-base font-semibold text-fg">Connect Stripe to get paid</h2>
      <p className="mt-1.5 max-w-xl text-sm text-fg-muted">
        Paid packages are sold through Stripe Connect Express. Buyers pay by card at
        checkout; Stripe pays your share out to your bank on its usual payout schedule. You
        keep 90% of every sale — OpenAgents takes a 10% platform fee. Connecting takes a
        couple of minutes: Stripe collects your business details and bank account, then
        sends you back here.
      </p>
      <div className="mt-4">
        <ConnectStripeButton label="Connect Stripe" />
      </div>
    </div>
  );
}

function NotOnboarded() {
  return (
    <div>
      <h2 className="text-base font-semibold text-fg">Finish onboarding</h2>
      <p className="mt-1.5 max-w-xl text-sm text-fg-muted">
        You started connecting Stripe but haven&apos;t finished onboarding yet — Stripe still
        needs a few more details before it can pay you out. Pick up where you left off.
      </p>
      <div className="mt-4">
        <ConnectStripeButton label="Finish onboarding" />
      </div>
    </div>
  );
}

function Onboarded({ accountId }: { accountId: string }) {
  const masked = `••••${accountId.slice(-4)}`;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
        <h2 className="text-base font-semibold text-accent">Payouts active</h2>
      </div>
      <dl className="mt-3 flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-fg-muted">Stripe account</dt>
          <dd className="font-mono text-fg">{masked}</dd>
        </div>
      </dl>
      <p className="mt-3 max-w-xl text-sm text-fg-muted">
        Payout timing, bank details, and tax forms are managed in your{" "}
        <a
          href="https://dashboard.stripe.com/express"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent hover:text-accent-hover"
        >
          Stripe Express dashboard
        </a>
        , not here.
      </p>
    </div>
  );
}
