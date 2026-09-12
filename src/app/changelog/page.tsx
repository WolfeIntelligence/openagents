import Link from "next/link";
import type { Metadata } from "next";
import { listRecentChangelogEntries } from "@/lib/changelog";
import { Markdown } from "@/components/Markdown";
import { KindBadge } from "@/components/KindBadge";
import { absoluteUrl, SITE_NAME } from "@/lib/site";

type ChangelogSearchParams = { owner?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<ChangelogSearchParams>;
}): Promise<Metadata> {
  const { owner } = await searchParams;
  const title = owner ? `Changelog · @${owner}` : "Changelog";
  return {
    title,
    description: `What's new across ${SITE_NAME} packages.`,
    // Each page re-declares the RSS link it wants rather than inheriting the
    // root layout's `/feed.xml` one — Next doesn't deep-merge `alternates`
    // between a page and its layout, so a child page's `alternates` replaces
    // the parent's wholesale. The package page does the same for its own
    // feed link; see AGENTS.md/this workstream's final report for the note
    // about the layout itself not being touched here.
    alternates: {
      canonical: absoluteUrl(owner ? `/changelog?owner=${encodeURIComponent(owner)}` : "/changelog"),
      types: { "application/rss+xml": absoluteUrl(owner ? `/changelog.xml?owner=${encodeURIComponent(owner)}` : "/changelog.xml") },
    },
  };
}

export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<ChangelogSearchParams>;
}) {
  const { owner } = await searchParams;
  const entries = await listRecentChangelogEntries({ owner });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="border-b border-border pb-6">
        <h1 className="text-2xl font-semibold text-fg">Changelog</h1>
        <p className="mt-2 text-sm text-fg-muted">
          What&apos;s new across every package on {SITE_NAME}
          {owner ? (
            <>
              {" "}
              from <span className="font-mono">@{owner}</span>
            </>
          ) : null}
          .
        </p>
        <a
          href={owner ? `/changelog.xml?owner=${encodeURIComponent(owner)}` : "/changelog.xml"}
          className="mt-2 inline-block text-xs font-medium text-accent hover:text-accent-hover"
        >
          RSS feed
        </a>
      </div>

      {entries.length === 0 ? (
        <p className="mt-6 text-sm text-fg-muted">
          {owner ? `No published versions from @${owner} yet.` : "No published versions yet."}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-6">
          {entries.map((entry) => (
            <li
              key={`${entry.owner}/${entry.name}@${entry.version}`}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={`/p/${entry.owner}/${entry.name}`}
                    className="truncate font-mono text-sm font-semibold text-fg hover:text-accent"
                  >
                    {entry.owner}/{entry.name}
                  </Link>
                  <KindBadge kind={entry.kind} />
                  <span className="shrink-0 font-mono text-xs text-fg-subtle">v{entry.version}</span>
                </div>
                <span className="shrink-0 text-xs text-fg-subtle">
                  {new Date(entry.publishedAt).toLocaleDateString()}
                </span>
              </div>

              {entry.changelog ? (
                <div className="mt-2 text-sm">
                  <Markdown content={entry.changelog} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-fg-subtle">No changelog provided.</p>
              )}

              {entry.previousVersion && (
                <Link
                  href={`/p/${entry.owner}/${entry.name}/compare?from=${entry.previousVersion}&to=${entry.version}`}
                  className="mt-2 inline-block text-xs font-medium text-accent hover:underline"
                >
                  Compare with v{entry.previousVersion}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
