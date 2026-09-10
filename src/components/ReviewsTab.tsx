import Link from "next/link";
import { getOwnReview, getReviewsPage } from "@/lib/reviews";
import { RatingStars } from "@/components/RatingStars";
import { ReviewForm } from "@/components/ReviewForm";

interface ReviewsTabProps {
  owner: string;
  name: string;
  isOwner: boolean;
  /** Signed-in user's id, or undefined when signed out. */
  userId?: string;
  /** Signed-in user's handle, used only to label their own review "(you)" in
   *  the list below — the form above is what they actually edit. */
  userHandle?: string;
}

/** Reviews list + the caller's own review form, for the package page's Reviews
 *  tab. The tab itself is only rendered when `isDbEnabled()` (see the package
 *  page) — every read here already no-ops safely without a database too. */
export async function ReviewsTab({ owner, name, isOwner, userId, userHandle }: ReviewsTabProps) {
  const [page, ownReview] = await Promise.all([
    getReviewsPage(owner, name, { limit: 50 }),
    userId && !isOwner ? getOwnReview(userId, owner, name) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {page.average !== undefined && page.count > 0 && (
        <div className="flex items-center gap-2">
          <RatingStars average={page.average} count={page.count} />
        </div>
      )}

      {isOwner ? (
        <p className="text-sm text-fg-muted">You can&apos;t review your own package.</p>
      ) : userId ? (
        <ReviewForm
          owner={owner}
          name={name}
          initialRating={ownReview?.rating}
          initialBody={ownReview?.body ?? undefined}
        />
      ) : (
        <p className="text-sm text-fg-muted">
          <Link
            href={`/signin?callbackUrl=${encodeURIComponent(`/p/${owner}/${name}?tab=reviews`)}`}
            className="text-accent hover:text-accent-hover"
          >
            Sign in
          </Link>{" "}
          to leave a review.
        </p>
      )}

      {page.items.length === 0 ? (
        <p className="text-sm text-fg-muted">No reviews yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {page.items.map((review) => (
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
