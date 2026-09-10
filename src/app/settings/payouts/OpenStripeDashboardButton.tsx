"use client";

import { useState } from "react";

/** Fetches a fresh Stripe Express Dashboard login link and redirects to it. Mirrors
 *  `ConnectStripeButton`'s fetch/redirect shape, against `./login-link` instead of
 *  `/api/connect/onboard`. */
export function OpenStripeDashboardButton({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleClick() {
    setStatus("loading");
    try {
      const res = await fetch("/settings/payouts/login-link", { method: "POST" });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data: unknown = await res.json();
      const url =
        data && typeof data === "object" && "url" in data
          ? (data as { url?: string }).url
          : undefined;
      if (url) {
        window.location.href = url;
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "loading"}
        className={`inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:border-border-strong disabled:opacity-60 ${className}`}
      >
        {status === "loading" ? "Opening Stripe…" : "Open Stripe dashboard"}
      </button>
      {status === "error" && (
        <p className="text-xs text-danger">
          Couldn&apos;t open the Stripe dashboard. Try again in a moment.
        </p>
      )}
    </div>
  );
}
