import { activeAdvisories, affectsVersion, type Advisory, type AdvisorySeverity } from "@/lib/advisories";

// Static per-severity classes (Tailwind needs literal class strings — same
// pattern as StatusBadge/KindBadge's *_STYLES maps). Critical/high read as a
// red warning; moderate as amber (same family DeprecationBanner/StatusBadge's
// "pending" use); low as a quieter neutral notice.
const SEVERITY_STYLES: Record<AdvisorySeverity, string> = {
  critical: "border-red-400 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  high: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  moderate:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  low: "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
};

const SEVERITY_BADGE_STYLES: Record<AdvisorySeverity, string> = {
  critical: "border-red-400 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200",
  high: "border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200",
  moderate:
    "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-200",
  low: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

/**
 * Public-facing security notice (Z2), rendered right after `DeprecationBanner`
 * whenever an active advisory affects the version currently on the page.
 * Async server component — fetches its own data from `owner`/`name`/`version`
 * (see `RelatedPackages` for the same pattern), so the page only needs to
 * mount it, not fetch anything for it. Renders nothing when there's nothing
 * relevant to show — an advisory that's been withdrawn, or one scoped to
 * versions other than this one.
 */
export async function AdvisoryBanner({
  owner,
  name,
  version,
}: {
  owner: string;
  name: string;
  version: string;
}) {
  const advisories = await activeAdvisories(owner, name);
  const relevant = advisories.filter((a) => affectsVersion(a, version));
  if (relevant.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-2">
      {relevant.map((advisory) => (
        <AdvisoryCard key={advisory.id} advisory={advisory} />
      ))}
    </div>
  );
}

function AdvisoryCard({ advisory }: { advisory: Advisory }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${SEVERITY_STYLES[advisory.severity]}`}>
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_BADGE_STYLES[advisory.severity]}`}
        >
          {advisory.severity}
        </span>
        {advisory.title}
      </p>
      <p className="mt-1.5 whitespace-pre-wrap">{advisory.body}</p>
      {(advisory.affectedVersions || advisory.fixedInVersion) && (
        <p className="mt-1.5 text-xs opacity-80">
          {advisory.affectedVersions && <>Affects {advisory.affectedVersions}. </>}
          {advisory.fixedInVersion && <>Fixed in v{advisory.fixedInVersion}.</>}
        </p>
      )}
    </div>
  );
}
