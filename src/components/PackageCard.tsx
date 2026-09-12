import Link from "next/link";
import type { PackageSummary, PackageStatus } from "@/lib/types";
import { KindBadge } from "@/components/KindBadge";
import { PricingBadge } from "@/components/PricingBadge";
import { RatingStars } from "@/components/RatingStars";

const STATUS_PILL_LABEL: Partial<Record<PackageStatus, string>> = {
  deprecated: "Deprecated",
  unlisted: "Unlisted",
  pending: "Pending",
};

const STATUS_PILL_TONE: Partial<Record<PackageStatus, string>> = {
  deprecated: "border-warning/40 bg-warning/10 text-fg",
  unlisted: "border-border-strong text-fg-muted",
  pending: "border-border-strong text-fg-muted",
};

/** Z3: packages that shipped something in the last two weeks get a visible
 *  "Updated" pill, not just the muted fallback text in the stats row below
 *  (which only shows at all when a package has zero stars/downloads). */
const RECENTLY_UPDATED_MS = 14 * 86_400_000;

function isRecentlyUpdated(iso: string): boolean {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then <= RECENTLY_UPDATED_MS;
}

export function PackageCard({ pkg }: { pkg: PackageSummary }) {
  const statusLabel = STATUS_PILL_LABEL[pkg.status];
  const recentlyUpdated = isRecentlyUpdated(pkg.updatedAt);

  return (
    <Link
      href={`/p/${pkg.owner}/${pkg.name}`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-fg-subtle">
            {pkg.owner}/{pkg.name}
          </p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-fg group-hover:text-accent">
            {pkg.title}
          </h3>
        </div>
        <PricingBadge pricing={pkg.pricing} className="shrink-0" />
      </div>

      <p className="line-clamp-2 flex-1 text-sm text-fg-muted">{pkg.summary}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <KindBadge kind={pkg.kind} />
        {recentlyUpdated && (
          <span className="inline-flex items-center rounded-full border border-accent-border bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent">
            Updated
          </span>
        )}
        {statusLabel && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_PILL_TONE[pkg.status]}`}
          >
            {statusLabel}
          </span>
        )}
        {pkg.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-subtle"
          >
            {tag}
          </span>
        ))}
      </div>

      {pkg.stats.ratingCount ? (
        <RatingStars average={pkg.stats.ratingAverage} count={pkg.stats.ratingCount} />
      ) : null}

      {/* Counts are real, so a package with no history shows no count at all
          rather than a row of zeros. New packages say so instead. */}
      <div className="flex items-center gap-4 border-t border-border pt-3 text-xs text-fg-subtle">
        {pkg.stats.stars > 0 && (
          <span className="inline-flex items-center gap-1">
            <StarIcon className="h-3.5 w-3.5" />
            {pkg.stats.stars.toLocaleString()}
          </span>
        )}
        {pkg.stats.downloads > 0 && (
          <span className="inline-flex items-center gap-1">
            <DownloadIcon className="h-3.5 w-3.5" />
            {pkg.stats.downloads.toLocaleString()}
          </span>
        )}
        {pkg.stats.stars === 0 && pkg.stats.downloads === 0 && (
          <span>Updated {formatUpdated(pkg.updatedAt)}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5 font-mono">
          v{pkg.version}
          {pkg.license && <span className="text-fg-subtle">&middot; {pkg.license}</span>}
        </span>
      </div>
    </Link>
  );
}

/** "today" / "3 days ago" / a plain date once it stops being news. */
function formatUpdated(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "recently";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 1.5l2.6 5.4 5.9.7-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.7L10 1.5Z" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden="true">
      <path d="M10 2.5v10m0 0-3.5-3.5M10 12.5 13.5 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 14.5v1.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-1.5" strokeLinecap="round" />
    </svg>
  );
}
