import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { getCatalog } from "@/lib/catalog";
import { CATALOG_ALL_LIMIT } from "@/lib/types";
import { getOrgByHandle, getOrgPayoutStatus, listOrgsForMember, type OrgPayoutStatus } from "@/lib/orgs";
import { getConnectedAccountStatus, isStripeEnabled } from "@/lib/stripe";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { OrgCard } from "@/components/OrgCard";
import { OrgMembers } from "@/components/OrgMembers";
import { OrgPayouts } from "@/components/OrgPayouts";
import { TransferPackage, type TransferDestination, type TransferablePackage } from "@/components/TransferPackage";
import { CreateOrgForm } from "./CreateOrgForm";

export const metadata: Metadata = {
  title: "Organizations",
  description: "Create and manage organizations, and transfer packages between them.",
};

interface OrgsSettingsPageProps {
  searchParams: Promise<{ connected?: string; refresh?: string }>;
}

export default async function OrgsSettingsPage({ searchParams }: OrgsSettingsPageProps) {
  const { connected, refresh } = await searchParams;

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/settings/orgs");
  }

  if (!isDbEnabled()) {
    return (
      <Shell>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-fg-muted">
            Organizations require a database, which isn&apos;t configured on this deployment.
          </p>
        </div>
      </Shell>
    );
  }

  const viewerHandle = session.user.handle;
  const memberships = await listOrgsForMember(session.user.id);
  const orgDetails = await Promise.all(memberships.map((m) => getOrgByHandle(m.handle)));

  const managedOrgs = memberships.filter((m) => m.role === "owner" || m.role === "admin");
  const destinations: TransferDestination[] = managedOrgs.map((m) => ({
    handle: m.handle,
    displayName: m.displayName,
  }));

  const stripeEnabled = isStripeEnabled();
  const managedHandles = new Set(managedOrgs.map((m) => m.handle));

  // Same eager-refresh reasoning as /settings/payouts: the webhook (v2 thin
  // events) is the source of truth long-term, but it may not have landed yet
  // when Stripe bounces the owner/admin straight back here from onboarding.
  // Only ever refreshes an org the caller actually manages — `connected`/
  // `refresh` are just query params, not proof of anything on their own.
  const justConnectedHandle = connected && managedHandles.has(connected) ? connected : undefined;
  if (justConnectedHandle && stripeEnabled) {
    const db = getDb();
    if (db) {
      const [org] = await db
        .select({ stripeAccountId: organizations.stripeAccountId, stripeOnboarded: organizations.stripeOnboarded })
        .from(organizations)
        .where(eq(organizations.handle, justConnectedHandle))
        .limit(1);
      if (org?.stripeAccountId) {
        try {
          const status = await getConnectedAccountStatus(org.stripeAccountId);
          if (status.onboarded !== org.stripeOnboarded) {
            await db
              .update(organizations)
              .set({ stripeOnboarded: status.onboarded })
              .where(eq(organizations.handle, justConnectedHandle));
          }
        } catch {
          // Stripe lookup failed — the freshly-fetched status below just falls
          // back to whatever's already in the DB, same as /settings/payouts.
        }
      }
    }
  }

  const payoutStatusByHandle = new Map<string, OrgPayoutStatus>();
  if (stripeEnabled) {
    await Promise.all(
      managedOrgs.map(async (m) => {
        const status = await getOrgPayoutStatus(m.handle);
        if (status) payoutStatusByHandle.set(m.handle, status);
      })
    );
  }

  // Transferable packages: the caller's own (personally-owned) published
  // packages, plus any owned by an org they manage — either can move to
  // another org they manage, or (for an org-owned one) back to themselves.
  const catalog = await getCatalog();
  const transferablePackages: TransferablePackage[] = [];
  if (viewerHandle) {
    const { items } = await catalog.list({ owner: viewerHandle, includeHidden: true, limit: CATALOG_ALL_LIMIT });
    for (const p of items) {
      if (p.source === "db") transferablePackages.push({ owner: p.owner, name: p.name, title: p.title });
    }
  }
  for (const org of managedOrgs) {
    const { items } = await catalog.list({ owner: org.handle, includeHidden: true, limit: CATALOG_ALL_LIMIT });
    for (const p of items) {
      if (p.source === "db") transferablePackages.push({ owner: p.owner, name: p.name, title: p.title });
    }
  }

  return (
    <Shell>
      <div className="flex flex-col gap-8">
        <section>
          <CreateOrgForm />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-fg">Your organizations</h2>
          {orgDetails.length === 0 ? (
            <p className="text-sm text-fg-muted">You&apos;re not a member of any organization yet.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {orgDetails.map((org, i) => {
                if (!org) return null;
                const role = memberships[i]?.role ?? null;
                const manages = role === "owner" || role === "admin";
                return (
                  <div key={org.handle} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row">
                    <div className="sm:w-64 sm:shrink-0">
                      <OrgCard org={org} role={role ?? undefined} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <OrgMembers
                        orgHandle={org.handle}
                        initialMembers={org.members}
                        viewerHandle={viewerHandle}
                        viewerRole={role}
                      />
                      {manages && stripeEnabled && (
                        <div className="mt-4 border-t border-border pt-4">
                          <OrgPayouts
                            orgHandle={org.handle}
                            status={payoutStatusByHandle.get(org.handle) ?? null}
                            justConnected={justConnectedHandle === org.handle}
                            justExpired={refresh === org.handle}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {transferablePackages.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-fg">Transfer a package</h2>
            <p className="mb-3 max-w-2xl text-sm text-fg-muted">
              Move a package you own (or that an organization you manage owns) to another
              organization you&apos;re an owner or admin of, or back to your own account.
            </p>
            <TransferPackage
              packages={transferablePackages}
              destinations={destinations}
              viewerHandle={viewerHandle}
            />
          </section>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Organizations</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        A shared publisher identity multiple users can manage together. Org packages show up at{" "}
        <span className="font-mono">/org/&lt;handle&gt;</span>, same as your own at{" "}
        <span className="font-mono">/u/&lt;handle&gt;</span>.
      </p>
      <div className="mt-8">{children}</div>
    </div>
  );
}
