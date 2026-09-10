const LABEL: Record<string, string> = {
  pending: "Pending review",
  live: "Live",
  unlisted: "Unlisted",
  deprecated: "Deprecated",
};

const TONE: Record<string, string> = {
  pending: "border-warning/40 bg-warning/10 text-fg",
  live: "border-accent-border bg-accent-muted text-accent",
  unlisted: "border-border-strong text-fg-muted",
  deprecated: "border-danger/40 bg-danger/10 text-danger",
};

/** Plain-text status pill for a seller's own package row on `/dashboard`.
 *  `packages.status` (and the seed catalog's implicit "live") are free text, so an
 *  unrecognized value still renders — just untinted — rather than throwing. */
export function PackageStatusPill({ status }: { status: string }) {
  const tone = TONE[status] ?? "border-border-strong text-fg-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {LABEL[status] ?? status}
    </span>
  );
}
