"use client";

// Interactive part of the Reviews tab (Z3): sort select + "Load more"
// pagination. A client component, unlike the file-viewer's server-rendered
// `?view=` links, because `ReviewsTab` (the server component that fetches the
// first page) can't add its own query params — `PackagePage`'s `searchParams`
// destructuring is out of scope for this workstream (only `VersionsTab` is
// owned in that file) — so paging further pages happens by calling the
// reviews API directly from the browser instead of navigating.

import { useState } from "react";

export interface ReviewItemView {
  id: string;
  user: { handle: string | null; name: string | null; image: string | null };
  rating: number;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  verifiedPurchase: boolean;
}

interface ReviewsListProps {
  owner: string;
  name: string;
  initialItems: ReviewItemView[];
  initialCount: number;
  pageSize: number;
  userHandle?: string;
}

const SORT_OPTIONS: { value: "newest" | "rating" | "helpful"; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "rating", label: "Highest rated" },
  { value: "helpful", label: "Most helpful" },
];

export function ReviewsList({ owner, name, initialItems, initialCount, pageSize, userHandle }: ReviewsListProps) {
  const [sort, setSort] = useState<"newest" | "rating" | "helpful">("newest");
  const [items, setItems] = useState(initialItems);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPage(nextSort: typeof sort, offset: number) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sort: nextSort, limit: String(pageSize), offset: String(offset) });
      const res = await fetch(`/api/v1/packages/${owner}/${name}/reviews?${params.toString()}`);
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      const newItems: ReviewItemView[] = Array.isArray(data.items) ? data.items : [];
      setCount(typeof data.count === "number" ? data.count : newItems.length);
      return newItems;
    } catch {
      setError("Couldn't load reviews. Try again.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleSortChange(value: string) {
    const nextSort = value as typeof sort;
    setSort(nextSort);
    const page = await fetchPage(nextSort, 0);
    if (page) setItems(page);
  }

  async function handleLoadMore() {
    const page = await fetchPage(sort, items.length);
    if (page) setItems((prev) => [...prev, ...page]);
  }

  const hasMore = items.length < count;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          Sort by
          <select
            value={sort}
            onChange={(e) => handleSortChange(e.target.value)}
            className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs text-fg"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-fg-subtle">
          {count} review{count === 1 ? "" : "s"}
        </span>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">No reviews yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((review) => (
            <li key={review.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-fg">
                    {review.user.name ?? (review.user.handle ? `@${review.user.handle}` : "A user")}
                    {userHandle && review.user.handle === userHandle && (
                      <span className="ml-1.5 text-xs font-normal text-fg-subtle">(you)</span>
                    )}
                  </span>
                  {review.verifiedPurchase && (
                    <span className="rounded-full border border-accent-border bg-accent-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                      Verified purchase
                    </span>
                  )}
                </div>
                <span className="text-xs text-fg-subtle">{formatDate(review.updatedAt)}</span>
              </div>
              <div className="mt-1.5">
                <StaticStars rating={review.rating} />
              </div>
              {review.body && <p className="mt-2 text-sm text-fg-muted">{review.body}</p>}
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loading}
          className="self-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong disabled:opacity-60"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

function StaticStars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 20 20"
          fill={n <= rating ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
          className={`h-3.5 w-3.5 ${n <= rating ? "text-warning" : "text-border-strong"}`}
          aria-hidden="true"
        >
          <path d="M10 1.5l2.6 5.4 5.9.7-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.7L10 1.5Z" />
        </svg>
      ))}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
