import type { Metadata } from "next";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";
import { PLATFORM_FEE_BPS } from "@/lib/stripe";

// Same source of truth the pricing page and checkout code use, so this page can't
// quote a fee percentage that drifts from what a creator is actually charged.
const FEE_PERCENT = PLATFORM_FEE_BPS / 100;

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The terms that govern using, publishing on, and buying from ${SITE_NAME}.`,
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Terms of Service</h1>
      <p className="mt-2 text-sm text-fg-muted">Last updated: September 10, 2026</p>

      <div className="prose-oa mt-8">
        <p>
          These terms govern your use of {SITE_NAME}, an open marketplace for
          agentic workflow packages (harnesses, rules, skills, and similar
          configuration for AI coding agents). By creating an account or using the
          site, you agree to these terms. If you don&rsquo;t agree, please
          don&rsquo;t use {SITE_NAME}.
        </p>

        <h2>Accounts and handles</h2>
        <p>
          You sign in with a GitHub or Google account. When you first sign in we
          assign you a public creator handle, which is shown next to any package you
          publish. You&rsquo;re responsible for activity that happens under your
          account, and for keeping the credentials for your GitHub or Google account
          secure.
        </p>

        <h2>Creator terms</h2>
        <p>These terms apply if you publish a package on {SITE_NAME}:</p>
        <ul>
          <li>
            <strong>You own your package.</strong> Publishing a package does not
            transfer ownership or copyright to {SITE_NAME}. You keep all rights to
            what you create.
          </li>
          <li>
            <strong>You grant us a hosting license.</strong> By publishing, you grant
            {" " + SITE_NAME} a non-exclusive, worldwide, royalty-free license to
            store, host, index, and distribute your package (including its source
            files and metadata) to users through the site, the CLI, and any API we
            offer, for as long as it remains published.
          </li>
          <li>
            <strong>The license field controls use.</strong> Every package declares a{" "}
            <code>license</code> field in its <code>openagent.yaml</code> manifest.
            That field is the license under which other users may use, modify, and
            redistribute your package&rsquo;s contents — it governs the package
            itself, separately from the hosting license you grant us above.
          </li>
          <li>
            <strong>Prohibited content.</strong> You may not publish a package that:
            contains malware, or is designed to exfiltrate secrets, credentials, or
            other data without the user&rsquo;s knowledge; violates any applicable
            law; or infringes someone else&rsquo;s copyright, trademark, or other
            intellectual property rights. We may remove packages that violate this
            and suspend accounts that repeatedly do.
          </li>
        </ul>

        <h2>Buyer terms</h2>
        <ul>
          <li>
            <strong>What you&rsquo;re buying.</strong> A one-time purchase of a paid
            package grants you a license to use it under the terms of that
            package&rsquo;s own <code>license</code> field — {SITE_NAME} is the
            marketplace, not the licensor.
          </li>
          <li>
            <strong>Downloads are tied to your account.</strong> Purchased packages
            remain available for download from your account for as long as your
            account and the package both exist.
          </li>
          <li>
            <strong>Refunds.</strong> One-time purchases can be refunded within 14 days:
            open a request from your <a href="/purchases">purchases page</a> and the seller
            (or we) will decide within 7 days. Subscriptions are cancelled through the billing
            portal instead. Full policy: <a href="/refund-policy">/refund-policy</a>. Questions:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </li>
          <li>
            <strong>Subscriptions.</strong> Some packages are sold as monthly or yearly
            subscriptions billed through Stripe. Access lasts until the end of the paid
            period; cancel any time from the billing portal on your purchases page, and
            you keep access until that period ends.
          </li>
        </ul>

        <h2>Payments</h2>
        <p>
          Paid packages are sold through Stripe Connect (Express accounts for
          creators). {SITE_NAME} charges a platform fee of {FEE_PERCENT}% of the
          sale price on paid packages, in addition to Stripe&rsquo;s own processing
          fees; the remainder is paid out to the creator&rsquo;s connected Stripe
          account. See the <a href="/pricing">pricing page</a> for the current
          numbers, which are always derived from this same fee.
        </p>

        <h2>Takedowns and copyright (DMCA)</h2>
        <p>
          If you believe a package on {SITE_NAME} infringes your copyright or other
          rights, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with
          a description of the work, the package URL, and your contact information.
          We will review and remove infringing content where appropriate.
        </p>

        <h2>Disclaimers</h2>
        <p>
          Packages on {SITE_NAME} are published by independent creators, not by{" "}
          {SITE_NAME} itself. You run any package inside your own agent, at your own
          risk. We do not review package contents for correctness, safety, or
          fitness for any purpose. Packages are provided &ldquo;as is,&rdquo; without
          warranty of any kind, express or implied.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, {SITE_NAME} and its operators will
          not be liable for any indirect, incidental, special, consequential, or
          punitive damages, or any loss of data, profits, or goodwill, arising from
          your use of the site or any package obtained through it.
        </p>

        <h2>Termination</h2>
        <p>
          You may stop using {SITE_NAME} and close your account at any time by
          contacting us. We may suspend or terminate accounts that violate these
          terms, including the prohibited-content rules above.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of the State of Florida, USA, without
          regard to conflict-of-law principles.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          We may update these terms as {SITE_NAME} evolves. We&rsquo;ll update the
          &ldquo;Last updated&rdquo; date above when we do, and material changes
          will be posted here.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </div>
    </div>
  );
}
