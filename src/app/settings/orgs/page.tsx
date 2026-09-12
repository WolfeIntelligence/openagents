import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { isDbEnabled } from "@/lib/db/client";
import { getCatalog } from "@/lib/catalog";
import { CATALOG_ALL_LIMIT } from "@/lib/types";
import { getOrgByHandle, listOrgsForMember } from "@/lib/orgs";
import { OrgCard } from "@/components/OrgCard";
import { OrgMembers } from "@/components/OrgMembers";
import { TransferPackage, type TransferDestination, type TransferablePackage } from "@/components/TransferPackage";
import { CreateOrgForm } from "./CreateOrgForm";

export const metadata: Metadata = {
  title: "Organizations",
  description: "Create and manage organizations, and transfer packages between them.",
};

export default async function OrgsSettingsPage() {
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
              {orgDetails.map((org, i) =>
                org ? (
                  <div key={org.handle} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row">
                    <div className="sm:w-64 sm:shrink-0">
                      <OrgCard org={org} role={memberships[i]?.role} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <OrgMembers
                        orgHandle={org.handle}
                        initialMembers={org.members}
                        viewerHandle={viewerHandle}
                        viewerRole={memberships[i]?.role ?? null}
                      />
                    </div>
                  </div>
                ) : null
              )}
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
