import { confirmCheckoutSession } from "@/lib/purchases";

/**
 * Renders the package-page banner for a `?checkout=success` redirect. The bare query
 * string is never trusted on its own — it's just a URL anyone could type or replay —
 * so this confirms the Checkout Session directly with Stripe (and records the purchase
 * if it hasn't been already) before telling the buyer they own the package. This makes
 * the banner accurate immediately after checkout even if the webhook hasn't been
 * delivered yet; the download button itself still depends on the purchase being
 * recorded, which is why an unconfirmed session tells the buyer to refresh rather than
 * claiming success.
 */
export async function CheckoutConfirmationBanner({
  userId,
  sessionId,
}: {
  userId?: string;
  sessionId?: string;
}) {
  const result =
    userId && sessionId
      ? await confirmCheckoutSession(sessionId, userId)
      : ({ ok: false, reason: "missing session" } as const);

  if (result.ok) {
    return (
      <div className="rounded-lg border border-accent-border bg-accent-muted p-3 text-sm text-fg">
        Purchase complete — you own this package.
      </div>
    );
  }

  const retryHref = sessionId
    ? `?checkout=success&session_id=${encodeURIComponent(sessionId)}`
    : "?checkout=success";

  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-sm text-fg-muted">
      Your payment is still processing —{" "}
      <a href={retryHref} className="text-accent hover:text-accent-hover">
        refresh
      </a>{" "}
      in a moment.
    </div>
  );
}
