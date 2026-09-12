import type { WeeklyCount } from "./data";

/**
 * Minimal inline-SVG bar chart for weekly signup counts — the bar-chart sibling
 * of src/components/Sparkline.tsx's line chart, kept local to this route since
 * nothing else needs a bar chart yet. Colored with `currentColor` so it
 * inherits the surrounding text color, same convention as `Sparkline`.
 */
export function WeeklyBars({ data, width = 360, height = 80 }: { data: WeeklyCount[]; width?: number; height?: number }) {
  const gap = 4;
  const barWidth = data.length > 0 ? (width - gap * (data.length - 1)) / data.length : width;
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const title = `Signups per week: ${total.toLocaleString()} total over the last ${data.length} weeks`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={title}>
      <title>{title}</title>
      {data.map((d, i) => {
        const barHeight = d.count > 0 ? Math.max(2, (d.count / max) * (height - 14)) : 1;
        const x = i * (barWidth + gap);
        const y = height - barHeight;
        return (
          <rect
            key={d.weekStart}
            x={x}
            y={y}
            width={Math.max(0, barWidth)}
            height={barHeight}
            fill="currentColor"
            opacity={d.count > 0 ? 0.75 : 0.25}
            rx={1}
          >
            <title>{`Week of ${d.weekStart}: ${d.count.toLocaleString()} signup${d.count === 1 ? "" : "s"}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
