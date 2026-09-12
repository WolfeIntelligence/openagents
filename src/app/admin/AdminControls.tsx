"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// Mirrors ADVISORY_SEVERITIES in src/lib/advisories.ts — duplicated (rather
// than imported) so this client bundle doesn't pull in that module's DB
// imports, same reasoning as ReportButton's local REASONS list.
const ADVISORY_SEVERITIES = ["low", "moderate", "high", "critical"] as const;

const GENERIC_ERROR = "Something went wrong. Try again.";

async function parseError(res: Response): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  return data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : `${GENERIC_ERROR} (${res.status})`;
}

/** Shared busy/error/refresh plumbing for every admin button below — each one
 *  fires a request, then `router.refresh()` so the server-rendered queue and
 *  featured list catch up without a full reload. */
function useBusyAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run };
}

export function ApproveRejectButtons({ owner, name }: { owner: string; name: string }) {
  const { busy, error, run } = useBusyAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() =>
              fetch(`/api/v1/admin/packages/${owner}/${name}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "live" }),
              })
            )
          }
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() =>
              fetch(`/api/v1/admin/packages/${owner}/${name}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "unlisted", reason: "Rejected by an admin." }),
              })
            )
          }
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong disabled:opacity-60"
        >
          Reject
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function ReportActions({ id }: { id: string }) {
  const { busy, error, run } = useBusyAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() =>
              fetch(`/api/v1/admin/reports/${id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "resolved" }),
              })
            )
          }
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          Resolve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() =>
              fetch(`/api/v1/admin/reports/${id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "dismissed" }),
              })
            )
          }
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong disabled:opacity-60"
        >
          Dismiss
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function FeaturedToggle({
  owner,
  name,
  featured,
}: {
  owner: string;
  name: string;
  featured: boolean;
}) {
  const { busy, error, run } = useBusyAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(() =>
            fetch(`/api/v1/admin/packages/${owner}/${name}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ featured: !featured }),
            })
          )
        }
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong disabled:opacity-60"
      >
        {featured ? "Unfeature" : "Feature"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Y2: toggles a collection's `featured` flag via
 *  `/api/v1/admin/collections/[handle]/[slug]` — same shape as `FeaturedToggle`
 *  above, for the "Featured collections" admin section. */
export function FeaturedCollectionToggle({
  owner,
  slug,
  featured,
}: {
  owner: string;
  slug: string;
  featured: boolean;
}) {
  const { busy, error, run } = useBusyAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(() =>
            fetch(`/api/v1/admin/collections/${owner}/${slug}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ featured: !featured }),
            })
          )
        }
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong disabled:opacity-60"
      >
        {featured ? "Unfeature" : "Feature"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Z2: withdraws an advisory via `PATCH .../advisories` (the id travels in
 *  the body — see the route's own doc comment on why). */
export function WithdrawAdvisoryButton({
  owner,
  name,
  id,
}: {
  owner: string;
  name: string;
  id: string;
}) {
  const { busy, error, run } = useBusyAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(() =>
            fetch(`/api/v1/packages/${owner}/${name}/advisories`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, withdrawn: true }),
            })
          )
        }
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong disabled:opacity-60"
      >
        Withdraw
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Z2: posts a new advisory for any package (owner/name typed in by the
 *  admin, since this form isn't scoped to one package page). */
export function PostAdvisoryForm() {
  const router = useRouter();
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [severity, setSeverity] = useState<(typeof ADVISORY_SEVERITIES)[number]>("moderate");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [affectedVersions, setAffectedVersions] = useState("");
  const [fixedInVersion, setFixedInVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/packages/${owner.trim()}/${name.trim()}/advisories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          severity,
          title: title.trim(),
          body: body.trim(),
          ...(affectedVersions.trim() ? { affectedVersions: affectedVersions.trim() } : {}),
          ...(fixedInVersion.trim() ? { fixedInVersion: fixedInVersion.trim() } : {}),
        }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      setOwner("");
      setName("");
      setTitle("");
      setBody("");
      setAffectedVersions("");
      setFixedInVersion("");
      setSeverity("moderate");
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <p className="text-sm font-medium text-fg">Post an advisory</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="owner"
          required
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name"
          required
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
        />
      </div>
      <select
        value={severity}
        onChange={(e) => setSeverity(e.target.value as (typeof ADVISORY_SEVERITIES)[number])}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg focus:border-border-strong focus:outline-none"
      >
        {ADVISORY_SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        required
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What happened, what an installer should do"
        rows={3}
        required
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          value={affectedVersions}
          onChange={(e) => setAffectedVersions(e.target.value)}
          placeholder="Affected versions, e.g. <1.3.0 (optional)"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
        />
        <input
          value={fixedInVersion}
          onChange={(e) => setFixedInVersion(e.target.value)}
          placeholder="Fixed in version (optional)"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex w-fit items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {busy ? "Posting…" : "Post advisory"}
      </button>
    </form>
  );
}
