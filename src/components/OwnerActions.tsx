"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PackageStatus } from "@/lib/types";

const GENERIC_ERROR = "Something went wrong. Try again.";

type Panel = null | "deprecate" | "delete";

async function parseError(res: Response): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  return data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : `${GENERIC_ERROR} (${res.status})`;
}

/**
 * Owner/admin lifecycle controls for a package page (G-D1). Not rendered at
 * all unless `viewerIsOwner` or `viewerIsAdmin` — the server decides who gets
 * to see this, this component only decides what they can click.
 *
 * Approve/Reject on a pending package and the general status changes below
 * all go through `POST …/status`, which already enforces who may do what
 * (the pending->live admin gate in particular). `Feature`/`Unfeature` is the
 * one action that isn't part of that contract and goes to the admin API
 * instead, so it's only ever shown to `viewerIsAdmin`.
 */
export function OwnerActions({
  owner,
  name,
  status,
  featured,
  deprecationMessage,
  replacementId,
  viewerIsOwner,
  viewerIsAdmin,
  hasPurchases,
}: {
  owner: string;
  name: string;
  status: PackageStatus;
  featured: boolean;
  deprecationMessage?: string;
  replacementId?: string;
  viewerIsOwner: boolean;
  viewerIsAdmin: boolean;
  hasPurchases: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [deprecateMessage, setDeprecateMessage] = useState(deprecationMessage ?? "");
  const [deprecateReplacement, setDeprecateReplacement] = useState(replacementId ?? "");

  if (!viewerIsOwner && !viewerIsAdmin) return null;

  async function callStatus(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/packages/${owner}/${name}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setMessage(await parseError(res));
        return;
      }
      setPanel(null);
      router.refresh();
    } catch {
      setMessage(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function toggleFeatured() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/packages/${owner}/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured: !featured }),
      });
      if (!res.ok) {
        setMessage(await parseError(res));
        return;
      }
      router.refresh();
    } catch {
      setMessage(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function submitDeprecate(e: FormEvent) {
    e.preventDefault();
    void callStatus({
      status: "deprecated",
      message: deprecateMessage.trim() || undefined,
      replacementId: deprecateReplacement.trim() || undefined,
    });
  }

  async function confirmDelete() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/packages/${owner}/${name}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      });
      if (!res.ok) {
        setMessage(await parseError(res));
        return;
      }
      router.push("/explore");
    } catch {
      setMessage(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const btnClass =
    "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="rounded-lg border border-border p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {viewerIsAdmin && !viewerIsOwner ? "Admin actions" : "Manage this package"}
      </h2>

      <div className="mt-3 flex flex-wrap gap-2">
        {status === "pending" && (
          <>
            <button type="button" disabled={busy} onClick={() => callStatus({ status: "live" })} className={btnClass}>
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                callStatus({
                  status: "unlisted",
                  message: viewerIsAdmin ? "Rejected by an admin." : undefined,
                })
              }
              className={btnClass}
            >
              {viewerIsAdmin ? "Reject" : "Withdraw"}
            </button>
          </>
        )}

        {status === "live" && (
          <button type="button" disabled={busy} onClick={() => callStatus({ status: "unlisted" })} className={btnClass}>
            Unlist
          </button>
        )}

        {(status === "unlisted" || status === "deprecated") && (
          <button type="button" disabled={busy} onClick={() => callStatus({ status: "live" })} className={btnClass}>
            Relist
          </button>
        )}

        {(status === "live" || status === "unlisted") && (
          <button type="button" disabled={busy} onClick={() => setPanel("deprecate")} className={btnClass}>
            Deprecate
          </button>
        )}

        {viewerIsAdmin && (
          <button type="button" disabled={busy} onClick={toggleFeatured} className={btnClass}>
            {featured ? "Unfeature" : "Feature"}
          </button>
        )}

        <button
          type="button"
          disabled={busy || hasPurchases}
          title={hasPurchases ? "This package has purchases — unlist it instead of deleting." : undefined}
          onClick={() => setPanel("delete")}
          className={`${btnClass} border-danger/40 text-danger hover:border-danger`}
        >
          Delete
        </button>
      </div>

      {message && <p className="mt-2 text-xs text-danger">{message}</p>}

      {panel === "deprecate" && (
        <form onSubmit={submitDeprecate} className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <label htmlFor="oa-deprecate-message" className="text-xs font-medium text-fg-muted">
            Deprecation message
          </label>
          <textarea
            id="oa-deprecate-message"
            value={deprecateMessage}
            onChange={(e) => setDeprecateMessage(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Why is this deprecated?"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
          <label htmlFor="oa-deprecate-replacement" className="text-xs font-medium text-fg-muted">
            Replacement package <span className="font-normal text-fg-subtle">(optional, &quot;owner/name&quot;)</span>
          </label>
          <input
            id="oa-deprecate-replacement"
            value={deprecateReplacement}
            onChange={(e) => setDeprecateReplacement(e.target.value)}
            placeholder="owner/name"
            className="rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-border-strong"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </form>
      )}

      {panel === "delete" && (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm text-fg-muted">
            This permanently deletes {owner}/{name} and its version history. This can&apos;t be undone.
          </p>
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-border-strong"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={confirmDelete}
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/20 disabled:opacity-60"
            >
              Confirm delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
