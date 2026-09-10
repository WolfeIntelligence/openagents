// Read-only average-rating display: a 5-star row (partially filled to the
// average) plus the numeric average and review count. Renders nothing when
// there's no rating yet — same "no history, no row" convention as the
// star/download counts on `PackageCard`.

const STAR_PATH =
  "M10 1.5l2.6 5.4 5.9.7-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.7L10 1.5Z";

function StarsRow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 20" className={className} fill="currentColor" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} transform={`translate(${i * 20}, 0)`} d={STAR_PATH} />
      ))}
    </svg>
  );
}

export function RatingStars({
  average,
  count,
  className = "",
  showCount = true,
}: {
  average?: number;
  count?: number;
  className?: string;
  /** Set false to show just the stars + average, no "(N)" suffix. */
  showCount?: boolean;
}) {
  if (!count || !average) return null;
  const pct = Math.max(0, Math.min(100, (average / 5) * 100));

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={`${average.toFixed(1)} out of 5 (${count.toLocaleString()} review${count === 1 ? "" : "s"})`}
    >
      <span className="relative inline-flex h-3.5 w-[4.5rem] shrink-0">
        <StarsRow className="absolute inset-0 h-3.5 w-[4.5rem] text-border-strong" />
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>
          <StarsRow className="h-3.5 w-[4.5rem] text-warning" />
        </span>
      </span>
      <span className="text-xs text-fg-muted">
        {average.toFixed(1)}
        {showCount && <span className="text-fg-subtle"> ({count.toLocaleString()})</span>}
      </span>
    </span>
  );
}
