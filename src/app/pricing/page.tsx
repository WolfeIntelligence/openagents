import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free forever for free packages. 10% platform fee on paid packages.",
};

const FAQ = [
  {
    q: "Is publishing free packages really free?",
    a: "Yes. There is no fee to publish, host, or install a free package, and there never will be.",
  },
  {
    q: "How does the platform fee work?",
    a: "When a package is sold, OpenAgents takes a 10% platform fee. Stripe's own processing fees also apply. You keep the remaining ~90% (minus Stripe's cut), paid out to your connected account.",
  },
  {
    q: "Can I change a package from free to paid later?",
    a: "Yes, publish a new version with an updated pricing block in openagent.yaml.",
  },
  {
    q: "Do I need a business entity to sell packages?",
    a: "No. Stripe Connect Express supports individual creators; you'll complete a short onboarding flow to receive payouts.",
  },
];

const COMPARISON: { feature: string; free: string; paid: string }[] = [
  { feature: "Publish a package", free: "Free", paid: "Free" },
  { feature: "Install / download", free: "Free", paid: "Buyer pays once (or subscribes)" },
  { feature: "Platform fee", free: "None", paid: "10% of sale price" },
  { feature: "Payment processing", free: "N/A", paid: "Stripe fees apply" },
  { feature: "Creator payout", free: "N/A", paid: "~90% via Stripe Connect" },
  { feature: "Hosting & distribution", free: "Included", paid: "Included" },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Pricing</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Free packages are free forever — no fees, no catches. Paid packages carry a 10% platform
        fee so we can run payments, hosting, and distribution.
      </p>

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
        </div>
        <div className="rounded-lg border border-accent-border bg-accent-muted/40 p-6">
          <h2 className="text-base font-semibold text-fg">Paid packages</h2>
          <p className="mt-1 text-3xl font-bold text-fg">10%</p>
          <p className="mt-1 text-sm text-fg-muted">platform fee + Stripe fees, creators keep ~90%</p>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-fg-muted">
            <li>• One-time or subscription pricing</li>
            <li>• Stripe Connect payouts</li>
            <li>• Buy button on the package page</li>
            <li>• Same distribution as free packages</li>
          </ul>
        </div>
      </div>

      <div className="mt-10 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left">
              <th className="px-4 py-2 font-medium text-fg-muted">Feature</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Free</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Paid</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.feature} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-fg">{row.feature}</td>
                <td className="px-4 py-2 text-fg-muted">{row.free}</td>
                <td className="px-4 py-2 text-fg-muted">{row.paid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-fg">FAQ</h2>
        <dl className="mt-4 flex flex-col gap-5">
          {FAQ.map((item) => (
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
          Publish a package
        </Link>
      </div>
    </div>
  );
}
