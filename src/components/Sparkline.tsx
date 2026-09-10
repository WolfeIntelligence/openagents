export interface SparklinePoint {
  day: string; // YYYY-MM-DD
  count: number;
}

/**
 * Minimal inline-SVG sparkline — no chart library. Renders a `polyline` scaled to its
 * own `viewBox` (so it stays crisp at any display size via `width="100%"`), colored
 * with `currentColor` so it inherits the surrounding text color. Always renders
 * something sensible for zero data: a flat baseline rather than a division-by-zero or
 * an empty `<svg>`, so a brand-new package's sparkline isn't a blank box.
 */
export function Sparkline({
  data,
  label,
  width = 240,
  height = 40,
  className = "",
}: {
  data: SparklinePoint[];
  /** Describes what's being plotted, e.g. "openagents/pr-reviewer downloads" — used to
   *  build the accessible title/aria-label; not rendered visibly. */
  label: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const padding = 2;
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const max = Math.max(1, ...data.map((d) => d.count));

  const points =
    data.length > 1
      ? data
          .map((d, i) => {
            const x = padding + (i / (data.length - 1)) * (width - padding * 2);
            const y = height - padding - (d.count / max) * (height - padding * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ")
      : "";

  const rangeLabel =
    data.length > 0 ? `${data[0].day} through ${data[data.length - 1].day}` : "no data available";
  const title = `${label}: ${total.toLocaleString()} total, ${rangeLabel}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={title}
      preserveAspectRatio="none"
      className={className}
    >
      <title>{title}</title>
      {total === 0 || data.length < 2 ? (
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.35}
        />
      ) : (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
