import Link from "next/link";
import type { DocEntry } from "@/app/docs/docs-source";

export function DocsSidebar({ docs, activeSlug }: { docs: DocEntry[]; activeSlug?: string }) {
  return (
    <nav aria-label="Docs" className="shrink-0 lg:w-56">
      <ul className="flex flex-col gap-0.5">
        {docs.map((doc) => {
          const active = doc.slug === activeSlug;
          return (
            <li key={doc.slug}>
              <Link
                href={`/docs/${doc.slug}`}
                aria-current={active ? "page" : undefined}
                className={`block truncate rounded-md px-2.5 py-1.5 text-sm ${
                  active
                    ? "bg-accent-muted font-medium text-accent"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                }`}
              >
                {doc.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
