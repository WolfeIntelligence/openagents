import type { PackageKind } from "@/lib/types";
import { KIND_META } from "@/lib/runtimes";

// Static per-kind classes (Tailwind needs literal class strings to keep them in the build,
// so we don't derive classes from the dynamic KIND_META.color string).
const KIND_STYLES: Record<PackageKind, string> = {
  workflow:
    "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  harness:
    "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
  rules:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  skill:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

export function KindBadge({
  kind,
  className = "",
}: {
  kind: PackageKind;
  className?: string;
}) {
  const meta = KIND_META[kind];
  return (
    <span
      title={meta?.description}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${KIND_STYLES[kind]} ${className}`}
    >
      {meta?.label ?? kind}
    </span>
  );
}
