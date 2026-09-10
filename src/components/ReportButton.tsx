"use client";

import { useState, type FormEvent } from "react";

const REASONS: { value: string; label: string }[] = [
  { value: "prompt-injection", label: "Prompt injection" },
  { value: "malware", label: "Malware" },
  { value: "license", label: "License violation" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

const GENERIC_ERROR = "Couldn't submit the report. Try again.";

/** "Report this package" (G-M1). Works signed out — the report route accepts
 *  anonymous submissions with a stricter rate limit. */
export function ReportButton({ owner, name }: { owner: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0].value);
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState(GENERIC_ERROR);

  function close() {
    setOpen(false);
    setStatus("idle");
    setReason(REASONS[0].value);
    setDetails("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch(`/api/v1/packages/${owner}/${name}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, details: details.trim() || undefined }),
      });
      if (res.status === 201) {
        setStatus("sent");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const serverError =
        data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : GENERIC_ERROR;
      setErrorMessage(serverError);
      setStatus("error");
    } catch {
      setErrorMessage(GENERIC_ERROR);
      setStatus("error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted hover:border-border-strong hover:text-fg"
      >
        Report
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Report ${owner}/${name}`}
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-bg-elevated p-5 shadow-lg">
            {status === "sent" ? (
              <>
                <p className="text-sm text-fg">Thanks — we&apos;ve received your report.</p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-4 inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong"
                >
                  Close
                </button>
              </>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-fg">
                  Report {owner}/{name}
                </h2>
                <div>
                  <label htmlFor="oa-report-reason" className="mb-1 block text-xs font-medium text-fg-muted">
                    Reason
                  </label>
                  <select
                    id="oa-report-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="block w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg focus:border-border-strong focus:outline-none"
                  >
                    {REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="oa-report-details" className="mb-1 block text-xs font-medium text-fg-muted">
                    Details <span className="font-normal text-fg-subtle">(optional)</span>
                  </label>
                  <textarea
                    id="oa-report-details"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
                  />
                </div>
                {status === "error" && <p className="text-xs text-danger">{errorMessage}</p>}
                <div className="mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-border-strong"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                  >
                    {status === "loading" ? "Sending…" : "Submit report"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
