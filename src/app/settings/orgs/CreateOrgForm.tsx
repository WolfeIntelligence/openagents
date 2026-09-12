"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

async function readError(res: Response, fallback: string): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  if (data && typeof data === "object" && "error" in data) {
    return String((data as { error?: unknown }).error) || fallback;
  }
  return fallback;
}

/** Create-organization form for `/settings/orgs`. On success, refreshes the
 *  server component so the new org shows up in "Your organizations" below. */
export function CreateOrgForm() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim().toLowerCase(),
          displayName: displayName.trim(),
          bio: bio.trim() || undefined,
          website: website.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError(await readError(res, `Failed to create organization (${res.status}).`));
        return;
      }
      setHandle("");
      setDisplayName("");
      setBio("");
      setWebsite("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error while creating the organization. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
      >
        New organization
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-subtle">Handle</label>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="acme-labs"
            required
            className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-subtle">Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Acme Labs"
            required
            className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-fg-subtle">Bio (optional)</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
            className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-fg-subtle">Website (optional)</label>
          <input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
            className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-fit items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create organization"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:border-border-strong"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
