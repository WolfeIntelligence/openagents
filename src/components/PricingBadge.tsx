import type { Pricing } from "@/lib/types";
import { formatPricing } from "@/lib/format";

export function PricingBadge({
  pricing,
  className = "",
}: {
  pricing: Pricing;
  className?: string;
}) {
  const isFree = pricing.model === "free" || pricing.amountCents === 0;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium font-mono ${
        isFree
          ? "border-border-strong text-fg-muted"
          : "border-accent-border bg-accent-muted text-accent"
      } ${className}`}
    >
      {formatPricing(pricing)}
    </span>
  );
}
