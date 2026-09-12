import { getSourceByPackage } from "@/lib/sources";

/**
 * Pill shown next to `StatusBadge` in the package page header when a package
 * auto-publishes from a linked GitHub repo (Y7's `package_sources`) and its
 * most recent sync actually succeeded — `lastResult` is written by
 * `recordSyncResult` as `"published <version>"` on success, `"skipped: ..."`
 * or `"error: ..."` otherwise (see src/lib/sources.ts). Renders nothing for
 * every other case (no link, or a link whose last sync failed), same
 * "renders nothing rather than an empty/broken badge" pattern as
 * `StatusBadge` for "live".
 *
 * Async server component — fetches its own data from `owner`/`name` so the
 * page doesn't need a separate data-fetching pass just for this (see
 * `RelatedPackages` for the same pattern).
 */
export async function VerifiedSourceBadge({ owner, name }: { owner: string; name: string }) {
  const source = await getSourceByPackage(owner, name);
  if (!source || !source.lastResult?.startsWith("published")) return null;

  const url = `https://github.com/${source.repo}`;
  const title = source.ref
    ? `Auto-published from ${source.repo}@${source.ref}`
    : `Auto-published from ${source.repo}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3 fill-current">
        <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.39 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.7-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .22.15.47.55.39A8 8 0 0 0 8 0Z" />
      </svg>
      Verified source
    </a>
  );
}
