import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { desc, eq, gte } from "drizzle-orm";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { getCatalog } from "@/lib/catalog";
import { listQueue } from "@/lib/moderation";
import { packages, packageVersions } from "@/lib/db/schema";
import { CATALOG_ALL_LIMIT } from "@/lib/types";
import { listCollections } from "@/lib/collections";
import { listRecentAdvisories } from "@/lib/advisories";
import {
  ApproveRejectButtons,
  FeaturedCollectionToggle,
  FeaturedToggle,
  PostAdvisoryForm,
  ReportActions,
  WithdrawAdvisoryButton,
} from "@/app/admin/AdminControls";

/** Floor for the "Flagged uploads" section — versions scoring at or above
 *  this are worth a human glance even though publish.ts only auto-holds a
 *  package for review at 70+ (see HIGH_RISK_THRESHOLD in src/lib/publish.ts).
 *  Same default as `GET /api/v1/admin/scans`. */
const FLAGGED_MIN_SCORE = 40;
const FLAGGED_LIMIT = 50;

interface FlaggedVersion {
  owner: string;
  name: string;
  version: string;
  riskScore: number;
  scanFlags: string[];
  publishedAt: string;
}

/** Recent package versions scoring at or above `FLAGGED_MIN_SCORE`, newest
 *  first — same query `GET /api/v1/admin/scans` runs, inlined here so the
 *  admin page's initial render doesn't need a self-fetch. */
async function listFlaggedVersions(): Promise<FlaggedVersion[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select({
      owner: packages.owner,
      name: packages.name,
      version: packageVersions.version,
      riskScore: packageVersions.riskScore,
      scanFlags: packageVersions.scanFlags,
      publishedAt: packageVersions.publishedAt,
    })
    .from(packageVersions)
    .innerJoin(packages, eq(packageVersions.packageId, packages.id))
    .where(gte(packageVersions.riskScore, FLAGGED_MIN_SCORE))
    .orderBy(desc(packageVersions.publishedAt))
    .limit(FLAGGED_LIMIT);

  return rows.map((r) => ({ ...r, publishedAt: r.publishedAt.toISOString() }));
}

export const metadata: Metadata = {
  title: "Admin",
  description: "Pending packages, open reports, and featured packages (G-M2).",
};

// /admin — 404 for anyone who isn't an admin (rather than a 403 page, which
// would confirm the route exists to someone probing for it), "not
// configured" with no database, otherwise the review queue.
export default async function AdminPage() {
  const requester = await getRequester();
  if (!(await isAdmin(requester))) notFound();

  if (!isDbEnabled()) {
    return (
      <PageShell>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-fg-muted">
            The admin console requires a database, which isn&apos;t configured on this
            deployment.
          </p>
        </div>
      </PageShell>
    );
  }

  const catalog = await getCatalog();
  const [queue, { items: everything }, { items: allCollections }, flaggedVersions, recentAdvisories] =
    await Promise.all([
      listQueue(),
      catalog.list({ includeHidden: true, limit: CATALOG_ALL_LIMIT }),
      // Y2: every collection, public and private — admins can feature either.
      listCollections({ includePrivate: true, limit: 100 }),
      // Z2: recent high-risk publishes and every advisory, for the two
      // sections below.
      listFlaggedVersions(),
      listRecentAdvisories(),
    ]);

  // Featuring only works on DB-backed packages (setPackageFeatured needs a
  // packages row to update) — seed packages are featured via their
  // .meta.json instead, so they're left off this list rather than shown with
  // a toggle that would 404.
  const liveDbPackages = everything
    .filter((p) => p.source === "db" && p.status === "live")
    .sort((a, b) => a.id.localeCompare(b.id));

  return (
    <PageShell>
      <Section
        title="Pending packages"
        empty="Nothing waiting for review."
        isEmpty={queue.pending.length === 0}
      >
        <ul className="flex flex-col gap-3">
          {queue.pending.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div>
                <Link
                  href={`/p/${p.owner}/${p.name}`}
                  className="font-mono text-sm text-accent hover:text-accent-hover"
                >
                  {p.id}
                </Link>
                <p className="text-xs text-fg-subtle">
                  {p.title} · submitted {new Date(p.createdAt).toLocaleDateString()}
                </p>
              </div>
              <ApproveRejectButtons owner={p.owner} name={p.name} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Open reports" empty="No open reports." isEmpty={queue.reports.length === 0}>
        <ul className="flex flex-col gap-3">
          {queue.reports.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/p/${r.owner}/${r.name}`}
                  className="font-mono text-sm text-accent hover:text-accent-hover"
                >
                  {r.owner}/{r.name}
                </Link>
                <p className="text-xs text-fg-subtle">
                  {r.reason} · reported {new Date(r.createdAt).toLocaleDateString()}
                </p>
                {r.details && <p className="mt-1 max-w-md text-xs text-fg-muted">{r.details}</p>}
              </div>
              <ReportActions id={r.id} />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Featured packages"
        empty="No live database-backed packages yet."
        isEmpty={liveDbPackages.length === 0}
      >
        <ul className="flex flex-col gap-2">
          {liveDbPackages.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <Link
                href={`/p/${p.owner}/${p.name}`}
                className="font-mono text-sm text-accent hover:text-accent-hover"
              >
                {p.id}
              </Link>
              <FeaturedToggle owner={p.owner} name={p.name} featured={p.featured} />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Featured collections"
        empty="No collections yet."
        isEmpty={allCollections.length === 0}
      >
        <ul className="flex flex-col gap-2">
          {allCollections.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/c/${c.owner}/${c.slug}`}
                  className="truncate font-mono text-sm text-accent hover:text-accent-hover"
                >
                  {c.owner}/{c.slug}
                </Link>
                <p className="text-xs text-fg-subtle">
                  {c.title} · {c.itemCount} {c.itemCount === 1 ? "package" : "packages"}
                  {!c.isPublic && " · private"}
                </p>
              </div>
              <FeaturedCollectionToggle owner={c.owner} slug={c.slug} featured={c.featured} />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Flagged uploads"
        empty={`Nothing scored ${FLAGGED_MIN_SCORE} or higher recently.`}
        isEmpty={flaggedVersions.length === 0}
      >
        <ul className="flex flex-col gap-3">
          {flaggedVersions.map((v) => (
            <li key={`${v.owner}/${v.name}@${v.version}`} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href={`/p/${v.owner}/${v.name}`}
                  className="font-mono text-sm text-accent hover:text-accent-hover"
                >
                  {v.owner}/{v.name}@{v.version}
                </Link>
                <span className="text-xs font-medium text-fg-subtle">
                  risk score {v.riskScore} · {new Date(v.publishedAt).toLocaleDateString()}
                </span>
              </div>
              {v.scanFlags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {v.scanFlags.map((id) => (
                    <span
                      key={id}
                      className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-fg-subtle"
                    >
                      {id}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Advisories" empty="" isEmpty={false}>
        <div className="flex flex-col gap-6">
          <PostAdvisoryForm />
          {recentAdvisories.length === 0 ? (
            <p className="text-sm text-fg-muted">No advisories posted yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {recentAdvisories.map((a) => (
                <li key={a.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/p/${a.owner}/${a.name}`}
                        className="font-mono text-sm text-accent hover:text-accent-hover"
                      >
                        {a.owner}/{a.name}
                      </Link>
                      <p className="text-xs text-fg-subtle">
                        {a.severity} · {a.title}
                        {a.withdrawnAt && " · withdrawn"}
                      </p>
                    </div>
                    {!a.withdrawnAt && (
                      <WithdrawAdvisoryButton owner={a.owner} name={a.name} id={a.id} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Admin</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Review queue, reports, and featured packages.
      </p>
      <div className="mt-8 flex flex-col gap-10">{children}</div>
    </div>
  );
}

function Section({
  title,
  empty,
  isEmpty,
  children,
}: {
  title: string;
  empty: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {isEmpty ? <p className="mt-2 text-sm text-fg-muted">{empty}</p> : <div className="mt-4">{children}</div>}
    </section>
  );
}
