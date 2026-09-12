import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { REFUND_WINDOW_DAYS } from "@/lib/refunds";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: `How refunds work for one-time purchases on ${SITE_NAME}.`,
};

export default function RefundPolicyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Refund Policy</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Plain-language summary — the <Link href="/terms">Terms of Service</Link> govern in case of conflict.
      </p>

      <div className="prose-oa mt-8">
        <h2>One-time purchases</h2>
        <p>
          You can request a refund for a one-time (non-subscription) package purchase within{" "}
          {REFUND_WINDOW_DAYS} days of buying it, from the{" "}
          <Link href="/purchases">Purchases</Link> page. Tell us why — the seller (and, if needed, an
          admin) uses that to decide.
        </p>
        <p>
          You can have one open refund request per purchase at a time. If a request is denied, the
          purchase itself is unaffected — you keep access to what you bought.
        </p>

        <h2>How a request is decided</h2>
        <ul>
          <li>
            <strong>The seller decides first.</strong> The package&rsquo;s owner has 7 days to approve
            or deny a request, from their <Link href="/settings/payouts">Payouts</Link> page.
          </li>
          <li>
            <strong>Admin review as a backstop.</strong> If the seller hasn&rsquo;t acted within 7
            days, an {SITE_NAME} admin may step in and decide the request instead.
          </li>
          <li>
            <strong>Approval refunds in full.</strong> An approved request refunds the full purchase
            price back to your original payment method, including the platform fee — there are no
            partial refunds through this flow. Stripe typically shows the refund within 5&ndash;10
            business days.
          </li>
        </ul>

        <h2>Subscriptions</h2>
        <p>
          Subscription packages aren&rsquo;t refunded through this flow. Cancel anytime from the
          billing portal (the &ldquo;Manage subscription&rdquo; button on{" "}
          <Link href="/purchases">Purchases</Link>) — you keep access until the end of the period
          you&rsquo;ve already paid for, and you won&rsquo;t be charged again after that.
        </p>

        <h2>Not eligible</h2>
        <p>A purchase isn&rsquo;t eligible for a refund request when it is:</p>
        <ul>
          <li>older than {REFUND_WINDOW_DAYS} days,</li>
          <li>a subscription (cancel via the billing portal instead), or</li>
          <li>already refunded, failed, or disputed.</li>
        </ul>
      </div>
    </div>
  );
}
