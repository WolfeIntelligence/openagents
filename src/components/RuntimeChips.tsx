import Link from "next/link";
import type { RuntimeId } from "@/lib/types";
import { RUNTIMES } from "@/lib/runtimes";

interface RuntimeChipsProps {
  runtimes: RuntimeId[];
  className?: string;
  /** If set, chips link to /explore?runtime=<id> (preserving nothing else). */
  linkable?: boolean;
}

export function RuntimeChips({ runtimes, className = "", linkable = false }: RuntimeChipsProps) {
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {runtimes.map((id) => {
        const label = RUNTIMES[id]?.label ?? id;
        const chipClass =
          "inline-flex items-center rounded-md border border-border bg-surface px-2 py-1 text-xs font-mono text-fg-muted";
        return (
          <li key={id}>
            {linkable ? (
              <Link
                href={`/explore?runtime=${encodeURIComponent(id)}`}
                className={`${chipClass} hover:border-border-strong hover:text-fg`}
              >
                {label}
              </Link>
            ) : (
              <span className={chipClass}>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
