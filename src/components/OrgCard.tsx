import Link from "next/link";
import type { OrgSummary } from "@/lib/orgs";

/** Card for an organization — mirrors `CollectionCard`'s layout so the two
 *  read as one family wherever org/collection listings appear side by side. */
export function OrgCard({ org, role }: { org: OrgSummary; role?: string }) {
  return (
    <Link
      href={`/org/${org.handle}`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-fg-subtle">@{org.handle}</p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-fg group-hover:text-accent">
            {org.displayName}
          </h3>
        </div>
        {role && (
          <span className="inline-flex shrink-0 items-center rounded-full border border-border-strong px-2 py-0.5 text-xs font-medium capitalize text-fg-muted">
            {role}
          </span>
        )}
      </div>

      {org.bio ? (
        <p className="line-clamp-2 flex-1 text-sm text-fg-muted">{org.bio}</p>
      ) : (
        <p className="flex-1 text-sm text-fg-subtle">No description.</p>
      )}

      <div className="flex items-center gap-4 border-t border-border pt-3 text-xs text-fg-subtle">
        <span>
          {org.packageCount} {org.packageCount === 1 ? "package" : "packages"}
        </span>
      </div>
    </Link>
  );
}
