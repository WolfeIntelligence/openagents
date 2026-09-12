import Link from "next/link";
import { DEFAULT_REVIEWS_PAGE_SIZE, getOwnReview, getReviewsPage, ratingHistogram } from "@/lib/reviews";
import { RatingStars } from "@/components/RatingStars";
import { ReviewForm } from "@/components/ReviewForm";
import { ReviewsList } from "@/components/ReviewsList";

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
  const [page, ownReview, histogram] = await Promise.all([
    getReviewsPage(owner, name, { limit: DEFAULT_REVIEWS_PAGE_SIZE }),
    userId && !isOwner ? getOwnReview(userId, owner, name) : Promise.resolve(null),
    ratingHistogram(owner, name),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {page.average !== undefined && page.count > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <RatingStars average={page.average} count={page.count} />
          <RatingHistogramBars histogram={histogram} total={page.count} />
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

      <ReviewsList
        owner={owner}
        name={name}
        initialItems={page.items}
        initialCount={page.count}
        pageSize={DEFAULT_REVIEWS_PAGE_SIZE}
        userHandle={userHandle}
      />
    </div>
  );
}

/** 5-bar rating distribution (Z3), 5 stars down to 1 — each bar's width is
 *  that rating's share of every review, not just the visible page. Renders
 *  nothing when nobody has rated yet, matching `RatingStars`' own
 *  "no history, no row" convention. */
function RatingHistogramBars({
  histogram,
  total,
}: {
  histogram: Record<1 | 2 | 3 | 4 | 5, number>;
  total: number;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {([5, 4, 3, 2, 1] as const).map((stars) => {
        const count = histogram[stars];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={stars} className="flex items-center gap-2 text-xs text-fg-subtle">
            <span className="w-3 text-right font-mono">{stars}</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-warning" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-8 font-mono">{count}</span>
          </div>
        );
      })}
    </div>
  );
}
