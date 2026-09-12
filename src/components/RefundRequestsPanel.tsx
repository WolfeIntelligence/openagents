"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import type { RefundRequestRow } from "@/lib/refunds";

const GENERIC_ERROR = "Something went wrong. Try again.";

async function parseError(res: Response): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  return data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : `${GENERIC_ERROR} (${res.status})`;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  approved: "Approved",
  denied: "Denied",
  refunded: "Refunded",
};

const STATUS_TONE: Record<string, string> = {
  open: "border-warning/40 bg-warning/10 text-fg",
  approved: "border-accent-border bg-accent-muted text-accent",
  denied: "border-border-strong text-fg-muted",
  refunded: "border-border-strong text-fg-muted",
};

/** Approve/deny panel for open refund requests — used on `/settings/payouts`
 *  (seller: only their own packages' requests) and `/admin` (every request,
 *  same component, same `POST /api/v1/refunds/[id]` action route — that route
 *  itself resolves whether the caller is acting as seller or admin). */
export function RefundRequestsPanel({ requests }: { requests: RefundRequestRow[] }) {
  if (requests.length === 0) {
    return <p className="text-sm text-fg-muted">No refund requests.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {requests.map((r) => (
        <RefundRequestRowItem key={r.id} request={r} />
      ))}
    </ul>
  );
}

function RefundRequestRowItem({ request }: { request: RefundRequestRow }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "deny") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/v1/refunds/${request.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        setBusy(null);
        return;
      }
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
      setBusy(null);
    }
  }

  const tone = STATUS_TONE[request.status] ?? "border-border-strong text-fg-muted";
  const isOpen = request.status === "open";

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/p/${request.owner}/${request.name}`} className="font-mono text-sm text-accent hover:text-accent-hover">
            {request.owner}/{request.name}
          </Link>
          <span className="ml-2 text-xs text-fg-subtle">{request.title}</span>
        </div>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
          {STATUS_LABEL[request.status] ?? request.status}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-3 text-xs text-fg-subtle">
        <span className="font-mono text-fg">{formatPrice(request.amountCents, request.currency)}</span>
        {request.buyerHandle && <span>buyer: {request.buyerHandle}</span>}
        <span>requested {new Date(request.createdAt).toLocaleDateString()}</span>
      </div>

      <p className="text-sm text-fg-muted">{request.reason}</p>

      {request.sellerNote && (
        <p className="text-xs text-fg-subtle">
          <span className="font-medium">Note:</span> {request.sellerNote}
        </p>
      )}

      {isOpen && (
        <div className="mt-1 flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Optional note to the buyer"
            className="block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("approve")}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
            >
              {busy === "approve" ? "Refunding…" : "Approve & refund"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("deny")}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg hover:border-border-strong disabled:opacity-60"
            >
              {busy === "deny" ? "Denying…" : "Deny"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
