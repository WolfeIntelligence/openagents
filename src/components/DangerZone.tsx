"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";

interface DangerZoneProps {
  handle: string;
  /** Counts shown above the confirmation so a seller sees what's at stake before
   *  typing their handle — not authoritative (the API re-derives eligibility from
   *  scratch), just context. */
  summary: { packages: number; purchases: number; stars: number };
}

type Status = "idle" | "deleting" | "error";

/** Account-deletion UI: a typed handle confirmation gates the one irreversible
 *  action here (`DELETE /api/v1/account`), matching the same "type to confirm"
 *  pattern as `TokenManager`'s revoke, just with a stronger gate since this is
 *  whole-account rather than one token. On success, signs the browser out and
 *  sends it home — the server has already deleted (or anonymized) the account by
 *  the time this fires. */
export function DangerZone({ handle, summary }: DangerZoneProps) {
  const [confirmText, setConfirmText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const canSubmit = confirmText === handle && status !== "deleting";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (confirmText !== handle) return;

    setStatus("deleting");
    setMessage(null);

    try {
      const res = await fetch("/api/v1/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const errText =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : `Failed to delete account (${res.status}).`;
        setStatus("error");
        setMessage(errText);
        return;
      }

      await signOut({ callbackUrl: "/" });
    } catch {
      setStatus("error");
      setMessage("Network error while deleting your account. Try again.");
    }
  }

  return (
    <div className="rounded-lg border border-danger/40 p-5">
      <h2 className="text-base font-semibold text-danger">Delete account</h2>
      <p className="mt-1.5 max-w-xl text-sm text-fg-muted">
        This permanently removes your profile, API tokens, stars, and reviews.
      </p>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg-muted">
        <div className="flex gap-1.5">
          <dt>Packages you own:</dt>
          <dd className="font-mono text-fg">{summary.packages}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Purchases you&apos;ve made:</dt>
          <dd className="font-mono text-fg">{summary.purchases}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Stars:</dt>
          <dd className="font-mono text-fg">{summary.stars}</dd>
        </div>
      </dl>

      <ul className="mt-3 list-disc pl-5 text-sm text-fg-muted">
        <li>Packages you own with no purchases are deleted outright.</li>
        <li>
          A package you own that already has purchases must be unlisted first (from that
          package&apos;s page) — buyers who already installed it keep working access either way.
        </li>
        <li>
          If you&apos;ve made any sale, your account is anonymized rather than removed (your
          name, email, and photo are cleared, and your handle is replaced) so those packages
          don&apos;t end up owned by whoever claims your old handle next.
        </li>
        <li>An active subscription you&apos;ve bought must be canceled first from the billing portal.</li>
      </ul>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-2">
        <label htmlFor="oa-delete-confirm" className="text-sm font-medium text-fg">
          Type <span className="font-mono">{handle}</span> to confirm
        </label>
        <input
          id="oa-delete-confirm"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={handle}
          className="block w-full max-w-xs rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-subtle focus:border-danger focus:outline-none"
        />

        {status === "error" && message && <p className="text-sm text-danger">{message}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-2 inline-flex w-fit items-center justify-center rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
        >
          {status === "deleting" ? "Deleting…" : "Delete my account"}
        </button>
      </form>
    </div>
  );
}
