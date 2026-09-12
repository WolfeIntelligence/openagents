/** One number-plus-label tile for the admin analytics dashboard (Z5) — a
 *  headline value, its label, and an optional sublabel for supporting context
 *  (e.g. a net figure under a gross one). Purely presentational; every stat it
 *  renders is computed by src/app/admin/analytics/data.ts. */
export function AdminStatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-fg-muted">{sublabel}</p>}
    </div>
  );
}
