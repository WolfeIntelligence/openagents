import Link from "next/link";
import type { Metadata } from "next";
import { getCatalog } from "@/lib/catalog";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = {
  title: "Tags",
  description: "Every tag used across the OpenAgents catalog, with package counts.",
};

/** "code-review" -> "C" for the letter-grouped index; a tag with no leading
 *  letter (all-digits, punctuation) groups under "#". */
function groupLetter(tag: string): string {
  const c = tag.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

export default async function TagsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const catalog = await getCatalog();
  const allTags = await catalog.tags();

  const query = q?.trim().toLowerCase() ?? "";
  const filtered = query ? allTags.filter((t) => t.tag.toLowerCase().includes(query)) : allTags;

  const groups = new Map<string, { tag: string; count: number }[]>();
  for (const entry of [...filtered].sort((a, b) => a.tag.localeCompare(b.tag))) {
    const letter = groupLetter(entry.tag);
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(entry);
  }
  const letters = Array.from(groups.keys()).sort((a, b) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Tags</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {allTags.length.toLocaleString()} tag{allTags.length === 1 ? "" : "s"} across every package.
      </p>

      <form action="/tags" method="get" role="search" className="mt-6 max-w-sm">
        <label htmlFor="oa-tags-q" className="sr-only">
          Filter tags
        </label>
        <input
          id="oa-tags-q"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Filter tags…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent-border focus:outline-none"
        />
      </form>

      {filtered.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No tags match that filter"
            description="Try a different search term."
            action={
              <Link
                href="/tags"
                className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:border-border-strong"
              >
                Clear filter
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          {letters.map((letter) => (
            <section key={letter}>
              <h2 className="mb-3 text-sm font-semibold text-fg-subtle">{letter}</h2>
              <div className="flex flex-wrap gap-2">
                {groups.get(letter)!.map(({ tag, count }) => (
                  <Link
                    key={tag}
                    href={`/explore?tag=${encodeURIComponent(tag)}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
                  >
                    {tag}
                    <span className="font-mono text-xs text-fg-subtle">{count}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
