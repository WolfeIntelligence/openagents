import type { TocEntry } from "@/lib/toc";

/** README table of contents (G-C4) — shown above the README by `Markdown.tsx`
 *  itself when there are >=4 headings, so it appears wherever a README
 *  renders without every caller needing to remember to add it. */
export function Toc({ entries }: { entries: TocEntry[] }) {
  if (entries.length === 0) return null;
  const minLevel = Math.min(...entries.map((e) => e.level));

  return (
    <nav aria-label="Table of contents" className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Contents
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {entries.map((entry) => (
          <li key={entry.id} style={{ paddingLeft: `${(entry.level - minLevel) * 0.9}rem` }}>
            <a href={`#${entry.id}`} className="text-fg-muted hover:text-accent">
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
