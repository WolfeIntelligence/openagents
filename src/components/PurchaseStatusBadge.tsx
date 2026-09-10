const STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  refunded: "Refunded",
  disputed: "Disputed",
  failed: "Failed",
  pending: "Pending",
};

const STATUS_TONE: Record<string, string> = {
  paid: "border-accent-border bg-accent-muted text-accent",
  refunded: "border-border-strong text-fg-muted",
  disputed: "border-warning/40 bg-warning/10 text-fg",
  failed: "border-danger/40 bg-danger/10 text-danger",
  pending: "border-border-strong text-fg-muted",
};

/** Shared status pill for `/purchases` and `/settings/payouts` — `purchases.status` is
 *  a free-text column, so unknown values still render (just untinted) rather than
 *  throwing. */
export function PurchaseStatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "border-border-strong text-fg-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
