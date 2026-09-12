"use client";

import { useState, type FormEvent } from "react";

export interface TransferablePackage {
  owner: string;
  name: string;
  title: string;
}

export interface TransferDestination {
  handle: string;
  displayName: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  if (data && typeof data === "object" && "error" in data) {
    return String((data as { error?: unknown }).error) || fallback;
  }
  return fallback;
}

/**
 * Moves one of the caller's packages to an org they're owner/admin of, or
 * back to their own handle. `packages` should already be filtered to ones
 * the caller may transfer (their own, or an org's they manage) — this
 * component doesn't re-check eligibility client-side, the API does.
 */
export function TransferPackage({
  packages,
  destinations,
  viewerHandle,
}: {
  packages: TransferablePackage[];
  destinations: TransferDestination[];
  viewerHandle?: string;
}) {
  const [selectedPkg, setSelectedPkg] = useState(packages[0] ? `${packages[0].owner}/${packages[0].name}` : "");
  const [selectedTo, setSelectedTo] = useState(destinations[0]?.handle ?? viewerHandle ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (packages.length === 0) {
    return <p className="text-sm text-fg-muted">You don&apos;t have any packages to transfer.</p>;
  }

  const destinationOptions: TransferDestination[] = [
    ...destinations,
    ...(viewerHandle ? [{ handle: viewerHandle, displayName: `Yourself (@${viewerHandle})` }] : []),
  ];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const [owner, name] = selectedPkg.split("/");
    if (!owner || !name || !selectedTo) return;

    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/packages/${owner}/${name}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selectedTo }),
      });
      if (!res.ok) {
        setMessage({ kind: "error", text: await readError(res, `Transfer failed (${res.status}).`) });
        return;
      }
      const data = (await res.json()) as { id: string };
      setMessage({ kind: "ok", text: `Transferred to ${data.id}.` });
    } catch {
      setMessage({ kind: "error", text: "Network error while transferring. Try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-fg-subtle">Package</label>
        <select
          value={selectedPkg}
          onChange={(e) => setSelectedPkg(e.target.value)}
          className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
        >
          {packages.map((p) => (
            <option key={`${p.owner}/${p.name}`} value={`${p.owner}/${p.name}`}>
              {p.title} ({p.owner}/{p.name})
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-fg-subtle">Transfer to</label>
        <select
          value={selectedTo}
          onChange={(e) => setSelectedTo(e.target.value)}
          className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
        >
          {destinationOptions.map((d) => (
            <option key={d.handle} value={d.handle}>
              {d.displayName}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={submitting || !selectedTo}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
      >
        {submitting ? "Transferring…" : "Transfer"}
      </button>
      {message && (
        <p className={`w-full text-sm ${message.kind === "error" ? "text-danger" : "text-fg-muted"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
