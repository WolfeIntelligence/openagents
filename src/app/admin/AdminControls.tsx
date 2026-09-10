"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
