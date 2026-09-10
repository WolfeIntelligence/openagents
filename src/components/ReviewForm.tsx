"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ReviewFormProps {
  owner: string;
  name: string;
  /** Pre-filled when the caller already reviewed this package. */
  initialRating?: number;
  initialBody?: string;
}

/** Create/update/delete the signed-in caller's own review. A `PUT` upserts (one
 *  review per user per package), so submitting again just edits the existing one. */
export function ReviewForm({ owner, name, initialRating, initialBody }: ReviewFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialRating);
  const [rating, setRating] = useState(initialRating ?? 0);
  const [hoverRating, setHoverRating] = useState(0);
  const [body, setBody] = useState(initialBody ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setError("Pick a star rating.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/packages/${owner}/${name}/reviews`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, body: body.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError((data && typeof data === "object" && "error" in data ? String(data.error) : null) ?? "Couldn't save your review.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't save your review. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/packages/${owner}/${name}/reviews`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        setError("Couldn't remove your review.");
        return;
      }
      setRating(0);
      setBody("");
      router.refresh();
    } catch {
      setError("Couldn't remove your review. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const displayRating = hoverRating || rating;

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-fg">
        {isEditing ? "Your review" : "Leave a review"}
      </h3>

      <div className="mt-2 flex items-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onMouseEnter={() => setHoverRating(n)}
            onMouseLeave={() => setHoverRating(0)}
            onClick={() => setRating(n)}
            className="p-0.5"
          >
            <StarIcon filled={n <= displayRating} className="h-6 w-6" />
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="What did you think? (optional)"
        className="mt-3 w-full resize-y rounded-md border border-border bg-bg-elevated p-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
      />

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {isEditing ? "Update review" : "Submit review"}
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="text-sm text-fg-muted hover:text-danger disabled:opacity-60"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

function StarIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      className={`${className} ${filled ? "text-warning" : "text-fg-subtle"}`}
      aria-hidden="true"
    >
      <path d="M10 1.5l2.6 5.4 5.9.7-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.7L10 1.5Z" />
    </svg>
  );
}
