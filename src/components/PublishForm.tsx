"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ScanReport } from "@/components/ScanReport";
import type { ScanResult } from "@/lib/scan";

export interface PublishSuccess {
  id: string;
  version: string;
  url: string;
  /** Absent on responses from a pre-status backend; treated the same as "live". */
  status?: string;
  /** Publish-time content scan (see src/lib/scan.ts); absent on older backends. */
  scan?: ScanResult;
}

export type PublishSubmitResult =
  | { ok: true; data: PublishSuccess | null }
  | { ok: false; errors: string[] };

/**
 * POSTs a publish-shaped body (`/api/v1/publish` or `/api/v1/publish/import`)
 * and normalizes both the success and error response shapes. Shared by the
 * GitHub-import form below and `PublishWizard`'s directory-upload step 3, so
 * the two publish paths read a response the same way instead of each
 * re-implementing (and potentially drifting on) the same parsing.
 */
export async function submitPublishJson(url: string, body: Record<string, unknown>): Promise<PublishSubmitResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const data = (await res.json().catch(() => null)) as PublishSuccess | null;
    return { ok: true, data };
  }

  const data: unknown = await res.json().catch(() => null);
  const message =
    data && typeof data === "object" && "error" in data
      ? String((data as { error?: unknown }).error)
      : `Publish failed (${res.status}).`;
  const details =
    data && typeof data === "object" && "issues" in data && Array.isArray((data as { issues?: unknown }).issues)
      ? (data as { issues: unknown[] }).issues.map(String)
      : [];
  return { ok: false, errors: [message, ...details] };
}

export function ChangelogField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor="oa-publish-changelog" className="mb-1.5 block text-sm font-medium text-fg">
        What changed in this version{" "}
        <span className="font-normal text-fg-subtle">(optional)</span>
      </label>
      <textarea
        id="oa-publish-changelog"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Leave blank to use CHANGELOG.md's first section, if you included one."
        className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
      />
    </div>
  );
}

/** Error list shown under a publish form — includes a "Settings → Payouts" shortcut
 *  when one of the errors is the "connect Stripe first" message from `publishPackage`. */
export function PublishErrorBanner({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      <ul className="list-disc pl-4">
        {errors.map((err, i) => (
          <li key={i}>{err}</li>
        ))}
      </ul>
      {errors.some((err) => /stripe payouts/i.test(err)) && (
        <Link
          href="/settings/payouts"
          className="mt-2 inline-flex text-sm font-medium text-accent hover:text-accent-hover"
        >
          Go to Settings → Payouts
        </Link>
      )}
    </div>
  );
}

/** Terminal "published" state — shared by the GitHub-import form here and
 *  `PublishWizard`'s directory-upload flow, so both publish paths end the
 *  same way regardless of which step got them there. */
export function PublishSuccessBanner({ published }: { published: PublishSuccess | null }) {
  const isPending = published?.status === "pending";
  return (
    <div className="rounded-lg border border-accent-border bg-accent-muted p-6 text-sm text-fg">
      <p className="font-semibold">
        {published ? `${published.id}@${published.version} published.` : "Package published."}
      </p>
      <p className="mt-1 text-fg-muted">
        {isPending
          ? "It's awaiting review before it appears in listings and search."
          : "It's live now, no review queue."}{" "}
        {published ? (
          <Link href={published.url} className="text-accent hover:text-accent-hover">
            View the package
          </Link>
        ) : null}
      </p>
      {published?.scan && published.scan.flags.length > 0 ? (
        <div className="mt-4">
          <ScanReport scan={published.scan} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * GitHub-import publish form: pick a repo (optionally a ref/subdirectory),
 * add a changelog, publish. Kept as a single step (unlike the directory
 * upload in `PublishWizard.tsx`) because there's no local file list here to
 * run `POST /api/v1/validate` against before publishing — the import route
 * fetches the repo's files server-side, so "Check" would need its own
 * server-side repo fetch to mean anything, which is out of scope here;
 * manifest/README issues from a bad import still surface as publish errors,
 * same as before this workstream.
 */
export function PublishForm() {
  const [changelog, setChangelog] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoRef, setRepoRef] = useState("");
  const [repoSubdir, setRepoSubdir] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [published, setPublished] = useState<PublishSuccess | null>(null);

  async function handleGitHubSubmit(e: FormEvent) {
    e.preventDefault();
    const repo = repoUrl.trim();
    if (!repo) {
      setErrors(["Enter a GitHub repo URL."]);
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrors([]);

    try {
      const result = await submitPublishJson("/api/v1/publish/import", {
        repo,
        ...(repoRef.trim() ? { ref: repoRef.trim() } : {}),
        ...(repoSubdir.trim() ? { subdir: repoSubdir.trim() } : {}),
        ...(changelog.trim() ? { changelog: changelog.trim() } : {}),
      });
      if (result.ok) {
        if (result.data?.url) setPublished(result.data);
        setStatus("success");
      } else {
        setErrors(result.errors);
        setStatus("error");
      }
    } catch {
      setErrors(["Network error while importing from GitHub. Try again."]);
      setStatus("error");
    }
  }

  if (status === "success") {
    return <PublishSuccessBanner published={published} />;
  }

  return (
    <form onSubmit={handleGitHubSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="oa-publish-repo" className="mb-1.5 block text-sm font-medium text-fg">
          GitHub repo URL
        </label>
        <input
          id="oa-publish-repo"
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-fg-subtle">
          Or paste a link to a subdirectory, e.g.{" "}
          <code className="font-mono">.../tree/main/packages/my-agent</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="oa-publish-ref" className="mb-1.5 block text-sm font-medium text-fg">
            Branch, tag, or commit{" "}
            <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <input
            id="oa-publish-ref"
            type="text"
            value={repoRef}
            onChange={(e) => setRepoRef(e.target.value)}
            placeholder="default branch"
            className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="oa-publish-subdir" className="mb-1.5 block text-sm font-medium text-fg">
            Subdirectory <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <input
            id="oa-publish-subdir"
            type="text"
            value={repoSubdir}
            onChange={(e) => setRepoSubdir(e.target.value)}
            placeholder="repo root"
            className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
      </div>

      <ChangelogField value={changelog} onChange={setChangelog} />
      <PublishErrorBanner errors={errors} />

      <button
        type="submit"
        disabled={status === "loading"}
        className="inline-flex w-fit items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {status === "loading" ? "Importing…" : "Import and publish"}
      </button>
    </form>
  );
}
