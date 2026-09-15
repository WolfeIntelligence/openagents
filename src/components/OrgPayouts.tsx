import { ConnectStripeButton } from "@/components/ConnectStripeButton";
import { OpenStripeDashboardButton } from "@/app/settings/payouts/OpenStripeDashboardButton";
import type { OrgPayoutStatus } from "@/lib/orgs";

/**
 * The org-scoped equivalent of `/settings/payouts`'s connect/onboarded panel,
 * rendered inline on `/settings/orgs` for a caller who's an owner/admin of
 * `orgHandle`. Every button here targets that org's own connected account
 * (via `ConnectStripeButton`/`OpenStripeDashboardButton`'s `org` prop), not
 * the viewer's personal one — an org-owned paid package is charged through
 * the org's account, so this is what actually needs to be connected before
 * one can be published (see `publish.ts`'s paid-package gate).
 */
export function OrgPayouts({
  orgHandle,
  status,
  justConnected,
  justExpired,
}: {
  orgHandle: string;
  status: OrgPayoutStatus | null;
  justConnected: boolean;
  justExpired: boolean;
}) {
  const accountId = status?.stripeAccountId ?? null;
  const onboarded = Boolean(status?.stripeOnboarded);

  return (
    <div>
      <h3 className="text-sm font-semibold text-fg">Payouts</h3>
      {justConnected && onboarded && (
        <p className="mt-1 text-xs text-accent">Stripe onboarding complete — payouts are active.</p>
      )}
      {justExpired && <p className="mt-1 text-xs text-warning">That onboarding link expired. Start again below.</p>}

      {!accountId ? (
        <>
          <p className="mt-1 max-w-md text-xs text-fg-muted">
            Connect Stripe before publishing a paid package under this organization — payouts
            go to the org&apos;s own account, not any one member&apos;s.
          </p>
          <div className="mt-2">
            <ConnectStripeButton label="Connect Stripe" org={orgHandle} className="text-xs" />
          </div>
        </>
      ) : !onboarded ? (
        <>
          <p className="mt-1 max-w-md text-xs text-fg-muted">
            Onboarding was started but Stripe still needs a few more details before it can pay
            this organization out.
          </p>
          <div className="mt-2">
            <ConnectStripeButton label="Finish onboarding" org={orgHandle} className="text-xs" />
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Active — <span className="font-mono text-fg">••••{accountId.slice(-4)}</span>
          </p>
          <div className="mt-2">
            <OpenStripeDashboardButton org={orgHandle} className="text-xs" />
          </div>
        </>
      )}
    </div>
  );
}
