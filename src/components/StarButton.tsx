"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Stars a package for the signed-in user. The count shown is the real number of
 * people who have pressed this button — it starts at zero for every package and
 * only ever moves because someone acted.
 */
export function StarButton({
  owner,
  name,
  initialStars,
  initialStarred,
  signedIn,
  enabled,
}: {
  owner: string;
  name: string;
  initialStars: number;
  initialStarred: boolean;
  /** Whether a user is signed in — drives the sign-in prompt rather than a failed POST. */
  signedIn: boolean;
  /** Whether starring is available at all on this deployment (needs a database). */
  enabled: boolean;
}) {
  const router = useRouter();
  const [stars, setStars] = useState(initialStars);
  const [starred, setStarred] = useState(initialStarred);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function handleClick() {
    if (!enabled) {
      setNote("Starring needs a database, which isn't configured here.");
      return;
    }
    if (!signedIn) {
      router.push(`/signin?callbackUrl=/p/${owner}/${name}`);
      return;
    }

    setBusy(true);
    setNote(null);

    // Optimistic: flip locally, then reconcile with whatever the server counted.
    const optimisticStarred = !starred;
    setStarred(optimisticStarred);
    setStars((n) => Math.max(0, n + (optimisticStarred ? 1 : -1)));

    try {
      const res = await fetch(`/api/v1/packages/${owner}/${name}/star`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { starred: boolean; stars: number };
      setStarred(data.starred);
      setStars(data.stars);
    } catch {
      setStarred(!optimisticStarred);
      setStars((n) => Math.max(0, n + (optimisticStarred ? -1 : 1)));
      setNote("Couldn't save that star. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-pressed={starred}
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
          starred
            ? "border-accent-border bg-accent-muted text-fg"
            : "border-border bg-surface text-fg hover:border-border-strong"
        }`}
      >
        <StarIcon filled={starred} className="h-4 w-4" />
        {starred ? "Starred" : "Star"}
        {stars > 0 && (
          <span className="ml-1 border-l border-border pl-2 font-mono text-xs text-fg-muted">
            {stars.toLocaleString()}
          </span>
        )}
      </button>
      {note && <p className="text-xs text-fg-subtle">{note}</p>}
    </div>
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
      className={className}
      aria-hidden="true"
    >
      <path d="M10 1.5l2.6 5.4 5.9.7-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.7L10 1.5Z" />
    </svg>
  );
}
