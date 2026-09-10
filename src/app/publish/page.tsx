import Link from "next/link";
import type { Metadata } from "next";
import { auth, isAuthEnabled } from "@/lib/auth";
import { isDbEnabled } from "@/lib/db/client";
import { isStripeEnabled, PLATFORM_FEE_BPS } from "@/lib/stripe";
import { PublishForm } from "@/components/PublishForm";
import { CopyButton } from "@/components/CopyButton";

export const metadata: Metadata = {
  title: "Publish",
  description: "Publish a workflow, harness, rules, or skill package to OpenAgents.",
};

const MANIFEST_EXAMPLE = `schema: 1
name: pr-reviewer
owner: openagents
version: 1.2.0
kind: workflow
title: Pull Request Reviewer
summary: One-line description (<= 160 chars)
license: MIT
tags: [code-review, github, quality]
runtimes: [claude-code, cursor, codex, generic]
pricing:
  model: free
  amount_cents: 0
  currency: usd
entry: WORKFLOW.md
files:
  - WORKFLOW.md
  - rules/review-checklist.md
inputs:
  - name: repo
    type: string
    required: true
    description: owner/name of the repository
requires:
  - openagents/base-rules@^1
`;

export default async function PublishPage() {
  const authEnabled = isAuthEnabled();
  const session = authEnabled ? await auth() : null;
  const dbEnabled = isDbEnabled();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Publish a package</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        A package is a directory containing an <code className="font-mono">openagent.yaml</code>{" "}
        manifest, a <code className="font-mono">README.md</code>, and any number of files. Free
        packages are always free to publish.{" "}
        {isStripeEnabled() ? (
          <>
            Paid packages keep a {100 - PLATFORM_FEE_BPS / 100}% creator share after the{" "}
            {PLATFORM_FEE_BPS / 100}% platform fee — connect a payout account first at{" "}
            <Link href="/settings/payouts" className="text-accent hover:text-accent-hover">
              Settings → Payouts
            </Link>
            .
          </>
        ) : (
          <>Paid packages are not accepting payments on this deployment yet.</>
        )}
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
          <span className="font-mono text-xs text-fg-subtle">openagent.yaml</span>
          <CopyButton value={MANIFEST_EXAMPLE} />
        </div>
        <pre className="overflow-x-auto bg-bg-elevated p-4 text-sm">
          <code className="font-mono text-fg">{MANIFEST_EXAMPLE}</code>
        </pre>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-border p-5">
          <h2 className="text-base font-semibold text-fg">Publish with the CLI</h2>
          <p className="mt-1.5 text-sm text-fg-muted">
            Run this from inside your package directory once your manifest and files are ready.
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2">
            <code className="font-mono text-sm text-fg">npx openagents publish</code>
            <CopyButton value="npx openagents publish" />
          </div>
          <p className="mt-2 text-xs text-fg-subtle">Coming soon.</p>
        </section>

        <section className="rounded-lg border border-border p-5">
          <h2 className="text-base font-semibold text-fg">Publish a free package</h2>
          <p className="mt-1.5 text-sm text-fg-muted">
            Free packages can also be contributed via pull request to the{" "}
            <code className="font-mono">catalog/</code> folder on GitHub — no account required.
          </p>
          <a
            href="https://github.com/WolfeIntelligence/openagents"
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex w-fit items-center rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:border-border-strong"
          >
            Open the catalog on GitHub
          </a>
        </section>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-fg">Upload</h2>

        {!authEnabled || !session?.user ? (
          <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-fg-muted">Sign in to upload a package.</p>
            {authEnabled ? (
              <Link
                href="/signin?callbackUrl=/publish"
                className="mt-3 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
              >
                Sign in
              </Link>
            ) : (
              <p className="mt-2 text-xs text-fg-subtle">
                Sign-in is not configured on this deployment.
              </p>
            )}
          </div>
        ) : !dbEnabled ? (
          <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-sm text-fg-muted">
            Publishing is enabled once the hosted database is configured — see{" "}
            <code className="font-mono">docs/SETUP.md</code>. Free packages can also be
            contributed via pull request to the <code className="font-mono">catalog/</code>{" "}
            folder.
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border p-6">
            <PublishForm />
          </div>
        )}
      </div>

      <p className="mt-8 text-sm text-fg-subtle">
        Read the full package format in the{" "}
        <Link href="/docs" className="text-accent hover:text-accent-hover">
          docs
        </Link>
        .
      </p>
    </div>
  );
}
