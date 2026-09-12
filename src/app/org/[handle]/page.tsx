import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCatalog, parseCatalogQuery } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { getOrgByHandle, getMemberRole } from "@/lib/orgs";
import { PackageCard } from "@/components/PackageCard";
import { EmptyState } from "@/components/EmptyState";
import { SortSelect } from "@/components/SortSelect";
import { Pagination } from "@/components/Pagination";

type Params = { handle: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 24;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await params;
  const org = await getOrgByHandle(handle);
  if (!org) return { title: "Organization not found" };
  return { title: org.displayName, description: org.bio ?? undefined };
}

export default async function OrgPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { handle } = await params;
  const rawParams = await searchParams;
  const org = await getOrgByHandle(handle);
  if (!org) notFound();

  const catalog = await getCatalog();
  const query = parseCatalogQuery(rawParams);
  const page = Math.max(1, Number(rawParams.page) || 1);

  const session = await auth();
  const viewerRole = session?.user?.id ? await getMemberRole(handle, session.user.id) : null;
  // Any member (not just owner/admin) gets to see the org's own pending/unlisted
  // packages here, same as an owner does on their personal /u/<handle> page.
  const isViewerMember = viewerRole !== null;

  const packagesPage = await catalog.list({
    owner: handle,
    sort: query.sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    includeHidden: isViewerMember,
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start gap-4 border-b border-border pb-8 sm:flex-row sm:items-center">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-hover text-2xl text-fg-muted">
          {org.displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-fg">{org.displayName}</h1>
            <span className="rounded-full border border-border-strong px-2 py-0.5 text-xs font-medium text-fg-muted">
              Organization
            </span>
          </div>
          <p className="font-mono text-sm text-fg-subtle">@{org.handle}</p>
          {org.bio && <p className="mt-1.5 max-w-xl text-sm text-fg-muted">{org.bio}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
            <span>{org.packageCount.toLocaleString()} packages</span>
            <span>
              {org.members.length} {org.members.length === 1 ? "member" : "members"}
            </span>
            {org.website && (
              <a
                href={org.website}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:text-accent-hover"
              >
                {org.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {isViewerMember && (
              <Link href="/settings/orgs" className="text-accent hover:text-accent-hover">
                Manage
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_16rem]">
        <div>
          {packagesPage.total > 0 && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-fg-muted">
                {packagesPage.total.toLocaleString()} package{packagesPage.total === 1 ? "" : "s"}
              </p>
              <SortSelect defaultValue={query.sort ?? "updated"} />
            </div>
          )}

          {packagesPage.items.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {packagesPage.items.map((pkg) => (
                  <PackageCard key={pkg.id} pkg={pkg} />
                ))}
              </div>
              <div className="mt-8">
                <Pagination
                  total={packagesPage.total}
                  page={page}
                  pageSize={PAGE_SIZE}
                  searchParams={rawParams}
                  basePath={`/org/${handle}`}
                />
              </div>
            </>
          ) : (
            <EmptyState
              title="No published packages yet"
              description={`${org.displayName} hasn't published any packages.`}
            />
          )}
        </div>

        <aside>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Members</h2>
          <ul className="flex flex-col gap-2">
            {org.members.map((m) => (
              <li key={m.handle}>
                <Link
                  href={`/u/${m.handle}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:border-border-strong"
                >
                  <span className="min-w-0 truncate font-mono text-fg">@{m.handle}</span>
                  <span className="shrink-0 text-xs capitalize text-fg-subtle">{m.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
