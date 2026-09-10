import { downloadsByDay, fillDailySeries } from "@/lib/analytics";
import { Sparkline } from "@/components/Sparkline";

const SPARKLINE_DAYS = 30;

/**
 * The package page sidebar's "Stats" section: the existing stars/downloads/updated/
 * source rows, plus a 30-day install sparkline underneath (G-A1). Fetches its own
 * download-history data so the page component doesn't need to know about analytics —
 * a safe no-op (empty series) when the DB is off, since `downloadsByDay` already
 * degrades that way.
 */
export async function StatsPanel({
  owner,
  name,
  stats,
  updatedAt,
  source,
}: {
  owner: string;
  name: string;
  stats: {
    downloads: number;
    stars: number;
    ratingAverage?: number;
    ratingCount?: number;
  };
  updatedAt: string;
  source: "seed" | "db";
}) {
  const rows = await downloadsByDay(owner, name, SPARKLINE_DAYS);
  const series = fillDailySeries(rows, SPARKLINE_DAYS);

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-fg-muted">Stars</dt>
          <dd className="font-mono text-fg">
            {stats.stars > 0 ? stats.stars.toLocaleString() : "None yet"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-fg-muted">Downloads</dt>
          <dd className="font-mono text-fg">
            {stats.downloads > 0 ? stats.downloads.toLocaleString() : "None yet"}
          </dd>
        </div>
        {stats.ratingCount ? (
          <div className="flex justify-between">
            <dt className="text-fg-muted">Rating</dt>
            <dd className="font-mono text-fg">
              {stats.ratingAverage!.toFixed(1)} ({stats.ratingCount.toLocaleString()})
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt className="text-fg-muted">Updated</dt>
          <dd className="text-fg">{new Date(updatedAt).toLocaleDateString()}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-fg-muted">Source</dt>
          <dd className="text-fg">{source}</dd>
        </div>
      </dl>
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-fg-subtle">
          Downloads, last {SPARKLINE_DAYS} days
        </p>
        <Sparkline data={series} label={`${owner}/${name} downloads`} className="text-accent" />
      </div>
    </div>
  );
}
