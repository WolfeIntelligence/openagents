"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CreatedCollection {
  owner: string;
  slug: string;
}

/** The actual create form for `/collections/new` — a client component so it
 *  can POST and redirect without a full page reload. The server page around
 *  it only decides whether to render this or bounce to sign-in. */
export function NewCollectionForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined, isPublic }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Something went wrong (${res.status}).`;
        setError(message);
        return;
      }
      const created = data as CreatedCollection;
      router.push(`/c/${created.owner}/${created.slug}`);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-fg">
          Title
        </label>
        <input
          id="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
          placeholder="My favorite review workflows"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-fg">
          Description <span className="text-fg-subtle">(optional)</span>
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          rows={3}
          className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
          placeholder="What ties these packages together?"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          disabled={busy}
          className="h-4 w-4 rounded border-border"
        />
        Public — anyone with the link can view it
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex w-fit items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
      >
        {busy ? "Creating…" : "Create collection"}
      </button>
    </form>
  );
}
