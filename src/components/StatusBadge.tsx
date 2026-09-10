import type { PackageStatus } from "@/lib/types";

const LABELS: Record<Exclude<PackageStatus, "live">, string> = {
  pending: "Pending review",
  unlisted: "Unlisted",
  deprecated: "Deprecated",
};

// Static per-status classes (Tailwind needs literal class strings), same
// pattern as KindBadge's KIND_STYLES.
const STYLES: Record<Exclude<PackageStatus, "live">, string> = {
  pending:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  unlisted:
    "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  deprecated:
    "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
};

/** Pill for a package's lifecycle status. Renders nothing for "live" — that's
 *  the default, unremarkable state and doesn't need a badge. */
export function StatusBadge({
  status,
  className = "",
}: {
  status: PackageStatus;
  className?: string;
}) {
  if (status === "live") return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]} ${className}`}
    >
      {LABELS[status]}
    </span>
  );
}
