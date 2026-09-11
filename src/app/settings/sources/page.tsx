import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { isDbEnabled } from "@/lib/db/client";
import { getCatalog } from "@/lib/catalog";
import { CATALOG_ALL_LIMIT } from "@/lib/types";
import { absoluteUrl } from "@/lib/site";
import { getSourceByPackage, isSourceSyncConfigured, secretStatus } from "@/lib/sources";
import { SourceSettings, type OwnedPackage, type SourceLink } from "@/components/SourceSettings";

export const metadata: Metadata = {
  title: "GitHub sync",
  description: "Link a package to a GitHub repo so a release or tag push republishes it automatically.",
};

export default async function SourcesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/settings/sources");
  }

  if (!isDbEnabled()) {
    return (
      <Shell>
        <NotConfigured message="GitHub sync requires a database; none is configured on this deployment." />
      </Shell>
    );
  }

  if (!isSourceSyncConfigured()) {
    return (
      <Shell>
        <NotConfigured message="GitHub sync is not configured on this deployment." />
      </Shell>
    );
  }

  const handle = session.user.handle;
  if (!handle) {
    return (
      <Shell>
        <p className="text-sm text-fg-muted">
          We don&apos;t have a handle on file for your account yet. Sign out and back in to pick
          one up.
        </p>
      </Shell>
    );
  }

  const catalog = await getCatalog();
  const { items } = await catalog.list({ owner: handle, includeHidden: true, limit: CATALOG_ALL_LIMIT });
  const ownedPackages: OwnedPackage[] = items
    .filter((p) => p.source === "db")
    .map((p) => ({ id: p.id, owner: p.owner, name: p.name, title: p.title }));

  const links: Record<string, SourceLink> = {};
  await Promise.all(
    ownedPackages.map(async (p) => {
      const row = await getSourceByPackage(p.owner, p.name);
      if (!row) return;
      const { secret } = secretStatus(row);
      links[p.id] = {
        id: row.id,
        repo: row.repo,
        ref: row.ref,
        subdir: row.subdir,
        lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
        lastResult: row.lastResult,
        webhookUrl: absoluteUrl(`/api/webhooks/github/${row.id}`),
        secret,
      };
    })
  );

  return (
    <Shell>
      {ownedPackages.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-fg-muted">
            You don&apos;t have any published packages to link yet.
          </p>
        </div>
      ) : (
        <SourceSettings ownedPackages={ownedPackages} initialLinks={links} />
      )}
    </Shell>
  );
}

function NotConfigured({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center">
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">GitHub sync</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Link a published package to its GitHub repo, then publishing a release (or
        pushing a tag) republishes it here automatically — no CLI, no re-upload.
      </p>
      <div className="mt-8">{children}</div>
    </div>
  );
}
