"use client";

import { useState } from "react";

const GENERIC_ERROR = "Something went wrong starting checkout. Try again.";

export function BuyButton({
  owner,
  name,
  label,
  className = "",
}: {
  owner: string;
  name: string;
  label: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "unconfigured" | "unauthorized" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string>(GENERIC_ERROR);

  async function handleClick() {
    setStatus("loading");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name }),
      });
      if (res.status === 503) {
        setStatus("unconfigured");
        return;
      }
      if (res.status === 401) {
        setStatus("unauthorized");
        return;
      }
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const serverError =
          data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : GENERIC_ERROR;
        setErrorMessage(serverError);
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
        setErrorMessage(GENERIC_ERROR);
        setStatus("error");
      }
    } catch {
      setErrorMessage(GENERIC_ERROR);
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "loading"}
        className={`inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60 ${className}`}
      >
        {status === "loading" ? "Starting checkout…" : label}
      </button>
      {status === "unconfigured" && (
        <p className="text-xs text-fg-subtle">
          Payments are not configured on this deployment yet.
        </p>
      )}
      {status === "unauthorized" && (
        <p className="text-xs text-fg-subtle">Sign in to buy this package.</p>
      )}
      {status === "error" && <p className="text-xs text-danger">{errorMessage}</p>}
    </div>
  );
}
