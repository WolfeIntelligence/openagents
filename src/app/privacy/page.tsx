import type { Metadata } from "next";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${SITE_NAME} collects, uses, and protects your data.`,
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Privacy Policy</h1>
      <p className="mt-2 text-sm text-fg-muted">Last updated: September 10, 2026</p>

      <div className="prose-oa mt-8">
        <p>
          {SITE_NAME} is an open marketplace for agentic workflow packages. This
          policy explains what information we collect when you use the site, why we
          collect it, and the choices you have. It applies to everyone who visits or
          creates an account on {SITE_NAME}, whether you&rsquo;re browsing the
          catalog, publishing a package, or buying one.
        </p>

        <h2>Information we collect</h2>
        <p>We collect only what we need to run the marketplace:</p>
        <ul>
          <li>
            <strong>Account profile.</strong> When you sign in with GitHub or Google,
            we receive your name, email address, avatar URL, and the provider&rsquo;s
            account id. We use this to create your {SITE_NAME} account and to display
            your public creator handle.
          </li>
          <li>
            <strong>Packages you publish.</strong> The contents of any package you
            publish (its <code>openagent.yaml</code> manifest, source files, README,
            and version history) are stored and made public in the catalog.
          </li>
          <li>
            <strong>Purchase records.</strong> If you buy a paid package, we store a
            record of the purchase (which package, which account, and the amount) so
            we can grant you download access and handle support or refund requests.
            We do not store your card number — Stripe handles payment collection
            directly; see &ldquo;Payments&rdquo; below.
          </li>
          <li>
            <strong>Server logs.</strong> Like most web services, our hosting and
            database providers automatically log request metadata such as IP address,
            user agent, and timestamps, for security and debugging.
          </li>
          <li>
            <strong>Usage counters.</strong> We track aggregate download and star
            counts per package to show popularity in the catalog. These counters are
            not tied to your identity in anything we display publicly.
          </li>
        </ul>

        <h2>What we don&rsquo;t collect</h2>
        <ul>
          <li>
            We never see or store your payment card number, bank account number, or
            other financial credentials. All payment processing is handled by Stripe.
          </li>
          <li>We do not sell, rent, or trade your personal data to anyone, ever.</li>
          <li>
            We do not run advertising trackers, ad pixels, or third-party analytics
            scripts that profile you across other sites.
          </li>
        </ul>

        <h2>Cookies</h2>
        <p>
          {SITE_NAME} uses a single session cookie to keep you signed in. It is
          required for the site to function and is not used for advertising or
          cross-site tracking. We do not use third-party ad or marketing cookies.
        </p>

        <h2>Third parties we work with</h2>
        <p>
          We rely on a small number of infrastructure providers to run {SITE_NAME}.
          Each only receives the data it needs to do its job:
        </p>
        <ul>
          <li>
            <strong>Vercel</strong> hosts the application and processes request logs.
          </li>
          <li>
            <strong>Neon</strong> hosts our Postgres database, where account,
            package, and purchase records live.
          </li>
          <li>
            <strong>Stripe</strong> processes all payments and, for creators who sell
            paid packages, handles Connect onboarding (identity and payout details you
            provide go directly to Stripe, not to us). Stripe&rsquo;s own privacy
            policy governs data you give it directly.
          </li>
          <li>
            <strong>GitHub and Google</strong> provide sign-in. We receive only the
            profile fields listed above under their standard OAuth consent screens.
          </li>
        </ul>

        <h2>Data retention</h2>
        <p>
          We keep account and purchase records for as long as your account is active,
          and afterward for as long as needed to satisfy tax, accounting, or legal
          obligations (for example, records of a completed sale). Published packages
          remain in the catalog, including in version history, unless removed under
          our takedown process or at your request.
        </p>

        <h2>Deletion requests</h2>
        <p>
          You can request deletion of your account and associated personal data at
          any time by emailing{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We&rsquo;ll delete
          what we can while preserving records we&rsquo;re legally required to keep
          (such as completed purchase records) and without removing packages you have
          published that other users depend on, unless you ask us to unpublish them.
        </p>

        <h2>Children&rsquo;s privacy</h2>
        <p>
          {SITE_NAME} is not directed to, and we do not knowingly collect information
          from, anyone under 13 years old. If you believe a child has created an
          account, contact us and we will remove it.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          We may update this policy as {SITE_NAME} evolves. We&rsquo;ll update the
          &ldquo;Last updated&rdquo; date above when we do, and material changes will
          be posted here.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy or your data? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </div>
    </div>
  );
}
