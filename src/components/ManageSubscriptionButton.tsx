"use client";

import { useState } from "react";

const GENERIC_ERROR = "Something went wrong opening the billing portal. Try again.";

/** Sends a subscriber to Stripe's hosted Billing Portal (payment method, invoices,
 *  cancel) via `POST /api/billing/portal`. Mirrors BuyButton's fetch-then-redirect
 *  shape so the two feel like the same family of control on `/purchases`. */
export function ManageSubscriptionButton({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleClick() {
    setStatus("loading");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
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
        {status === "loading" ? "Opening billing portal…" : "Manage subscription"}
      </button>
      {status === "error" && <p className="text-xs text-danger">{GENERIC_ERROR}</p>}
    </div>
  );
}
