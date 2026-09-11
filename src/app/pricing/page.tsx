import Link from "next/link";
import type { Metadata } from "next";
import { isStripeEnabled, PLATFORM_FEE_BPS } from "@/lib/stripe";

// The fee is read from the same constant the checkout code charges, so this page
// cannot drift away from what a creator is actually charged.
const FEE_PERCENT = PLATFORM_FEE_BPS / 100;
const CREATOR_PERCENT = 100 - FEE_PERCENT;

export const metadata: Metadata = {
  title: "Pricing",
  description: `Free forever for free packages. ${FEE_PERCENT}% platform fee on paid packages.`,
};

function faq(live: boolean): { q: string; a: string }[] {
  return [
    {
      q: "Is publishing free packages really free?",
      a: "Yes. There is no fee to publish, host, or install a free package, and there never will be.",
    },
    {
      q: "Can I sell a package today?",
      a: live
        ? `Yes. Connect a Stripe account from your payouts settings, set a pricing block in openagent.yaml, and publish. Buyers get a buy button on the package page.`
        : `Not yet. Payments are built but not switched on, so this deployment has no way to take a buyer's money or pay a creator. Every package in the catalog is free. The terms below are what will apply once payments go live, not something you can earn on today.`,
    },
    {
      q: "How will the platform fee work?",
      a: `When a package is sold, OpenAgents takes a ${FEE_PERCENT}% platform fee. Stripe's own processing fees also apply. You keep the remaining ~${CREATOR_PERCENT}% (minus Stripe's cut), paid out to your connected account.`,
    },
    {
      q: "Can I change a package from free to paid later?",
      a: "Yes, publish a new version with an updated pricing block in openagent.yaml.",
    },
    {
      q: "Will I need a business entity to sell packages?",
      a: "No. Stripe Connect Express supports individual creators; you'll complete a short onboarding flow to receive payouts.",
    },
  ];
}

const COMPARISON: { feature: string; free: string; paid: string }[] = [
  { feature: "Publish a package", free: "Free", paid: "Free" },
  { feature: "Install / download", free: "Free", paid: "Buyer pays once" },
  { feature: "Platform fee", free: "None", paid: `${FEE_PERCENT}% of sale price` },
  { feature: "Payment processing", free: "N/A", paid: "Stripe fees apply" },
  { feature: "Creator payout", free: "N/A", paid: `~${CREATOR_PERCENT}% via Stripe Connect` },
  { feature: "Hosting & distribution", free: "Included", paid: "Included" },
];

export default function PricingPage() {
  // Paid packages need Stripe configured to take a payment at all. When it isn't,
  // this page says so plainly rather than describing a feature that cannot run.
  const paymentsLive = isStripeEnabled();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Pricing</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Free packages are free forever — no fees, no catches. Paid packages{" "}
        {paymentsLive ? "carry" : "will carry"} a {FEE_PERCENT}% platform fee so we can run
        payments, hosting, and distribution.
      </p>

      {!paymentsLive && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-medium text-fg">Paid packages aren&rsquo;t live yet</p>
          <p className="mt-1.5 text-sm text-fg-muted">
            Payments are not switched on for this deployment, so nothing here can charge a
            buyer or pay a creator, and every package in the catalog is free. The paid terms
            below describe what is planned, not something you can earn on today. Publishing
            and installing free packages works fully.
          </p>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold text-fg">Free packages</h2>
          <p className="mt-1 text-3xl font-bold text-fg">$0</p>
          <p className="mt-1 text-sm text-fg-muted">forever, for creators and installers</p>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-fg-muted">
            <li>• No platform fee</li>
            <li>• Unlimited installs</li>
            <li>• Listed in Explore</li>
            <li>• Publish via CLI or pull request</li>
          </ul>
          <p className="mt-4 text-xs font-medium text-accent">Available now</p>
        </div>
        <div
          className={
            paymentsLive
              ? "rounded-lg border border-accent-border bg-accent-muted/40 p-6"
              : "rounded-lg border border-dashed border-border p-6"
          }
        >
          <h2 className="text-base font-semibold text-fg">Paid packages</h2>
          <p className="mt-1 text-3xl font-bold text-fg">{FEE_PERCENT}%</p>
          <p className="mt-1 text-sm text-fg-muted">
            platform fee + Stripe fees, creators keep ~{CREATOR_PERCENT}%
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-fg-muted">
            <li>• One-time pricing, or a subscription billed monthly or yearly</li>
            <li>• The platform fee applies to every charge — including each subscription renewal, not just the first</li>
            <li>• Stripe Connect payouts: sellers connect an account once, then get paid automatically</li>
            <li>• Buy (or Subscribe) button on the package page</li>
            <li>• Same distribution as free packages</li>
          </ul>
          <p className="mt-4 text-xs font-medium text-fg-subtle">
            {paymentsLive ? "Available now" : "Not accepting payments yet"}
          </p>
        </div>
      </div>

      <div className="mt-10 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left">
              <th className="px-4 py-2 font-medium text-fg-muted">Feature</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Free</th>
              <th className="px-4 py-2 font-medium text-fg-muted">
                Paid{!paymentsLive && <span className="font-normal"> (planned)</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.feature} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-fg">{row.feature}</td>
                <td className="px-4 py-2 text-fg-muted">{row.free}</td>
                <td className={`px-4 py-2 ${paymentsLive ? "text-fg-muted" : "text-fg-subtle"}`}>
                  {row.paid}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-fg">FAQ</h2>
        <dl className="mt-4 flex flex-col gap-5">
          {faq(paymentsLive).map((item) => (
            <div key={item.q}>
              <dt className="text-sm font-medium text-fg">{item.q}</dt>
              <dd className="mt-1 text-sm text-fg-muted">{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-10 rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-sm text-fg-muted">Ready to share what you&rsquo;ve built?</p>
        <Link
          href="/publish"
          className="mt-3 inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          Publish a free package
        </Link>
      </div>
    </div>
  );
}
