"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const GENERIC_ERROR = "Something went wrong. Try again.";
const MIN_REASON_CHARS = 10;

async function parseError(res: Response): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  return data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : `${GENERIC_ERROR} (${res.status})`;
}

export interface RefundRequestButtonProps {
  purchaseId: string;
  eligible: boolean;
  /** Why it isn't eligible — shown instead of a button when `eligible` is false. */
  ineligibleReason?: string;
  /** An open (unresolved) request already exists for this purchase. */
  hasOpenRequest?: boolean;
}

/** "Request refund" control for a `/purchases` row: a button that opens an
 *  inline reason field and posts to `POST /api/v1/refunds`, or — when the
 *  purchase isn't eligible, or already has an open request — a short
 *  explanatory line instead of a disabled-and-unexplained button. */
export function RefundRequestButton({
  purchaseId,
  eligible,
  ineligibleReason,
  hasOpenRequest,
}: RefundRequestButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [error, setError] = useState<string | null>(null);

  if (hasOpenRequest) {
    return <p className="text-xs text-fg-subtle">Refund requested — awaiting seller review.</p>;
  }

  if (status === "success") {
    return <p className="text-xs text-fg-subtle">Refund requested — awaiting seller review.</p>;
  }

  if (!eligible) {
    return (
      <p className="text-xs text-fg-subtle">
        Not eligible for a refund{ineligibleReason ? `: ${ineligibleReason}` : ""}.{" "}
        <Link href="/refund-policy" className="text-accent hover:text-accent-hover">
          Refund policy
        </Link>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-accent hover:text-accent-hover"
      >
        Request refund
      </button>
    );
  }

  async function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_CHARS) {
      setError(`Reason must be at least ${MIN_REASON_CHARS} characters.`);
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/v1/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseId, reason: trimmed }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        setStatus("error");
        return;
      }
      setStatus("success");
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
      setStatus("error");
    }
  }

  return (
    <div className="flex w-56 flex-col items-end gap-1.5">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Why are you requesting a refund? (10+ characters)"
        className="block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={status === "loading"}
          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-fg hover:border-border-strong disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={status === "loading"}
          className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          {status === "loading" ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </div>
  );
}
