import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCatalog } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { resolveAccess } from "@/lib/access";
import { KindBadge } from "@/components/KindBadge";
import { PricingBadge } from "@/components/PricingBadge";
import { RuntimeChips } from "@/components/RuntimeChips";
import { InstallBox } from "@/components/InstallBox";
import { BuyButton } from "@/components/BuyButton";
import { CheckoutConfirmationBanner } from "@/components/CheckoutConfirmationBanner";
import { Markdown } from "@/components/Markdown";
import { StarButton } from "@/components/StarButton";
import { isStarred } from "@/lib/stats";
import { isDbEnabled } from "@/lib/db/client";
import { formatPrice } from "@/lib/format";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { packageHasPurchases } from "@/lib/moderation";
import { StatusBadge } from "@/components/StatusBadge";
import { DeprecationBanner } from "@/components/DeprecationBanner";
import { OwnerActions } from "@/components/OwnerActions";
import { ReportButton } from "@/components/ReportButton";
import { ReviewsTab } from "@/components/ReviewsTab";
import { RatingStars } from "@/components/RatingStars";
import { StatsPanel } from "@/components/StatsPanel";

type Params = { owner: string; name: string };
type TabId = "readme" | "files" | "manifest" | "versions" | "reviews";
const TABS: { id: TabId; label: string }[] = [
  { id: "readme", label: "Readme" },
  { id: "files", label: "Files" },
  { id: "manifest", label: "Manifest" },
  { id: "versions", label: "Versions" },
  // Reviews need somewhere to be stored — hide the tab entirely rather than
  // show an empty/broken one when this deployment has no database.
  ...(isDbEnabled() ? [{ id: "reviews" as const, label: "Reviews" }] : []),
];

async function loadPackage(owner: string, name: string) {
  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);
  return pkg;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { owner, name } = await params;
  const pkg = await loadPackage(owner, name);
  if (!pkg) return { title: "Package not found" };
  return {
    title: pkg.manifest.title,
    description: pkg.manifest.summary,
  };
}

export default async function PackagePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ tab?: string; checkout?: string; session_id?: string }>;
}) {
  const { owner, name } = await params;
  const { tab: rawTab, checkout, session_id: checkoutSessionId } = await searchParams;
  const pkg = await loadPackage(owner, name);
  if (!pkg) notFound();

  // Visibility gate (G-M2): pending/unlisted packages render only for their
  // owner or an admin; everyone else gets the same 404 as a nonexistent
  // package. `requester`/`viewerIsAdmin`/`viewerIsOwner` are computed once
  // here and reused below to drive the owner action panel.
  const requester = await getRequester();
  const viewerIsAdmin = await isAdmin(requester);
  const viewerIsOwner = Boolean(requester?.handle && requester.handle === pkg.owner);
  if ((pkg.status === "pending" || pkg.status === "unlisted") && !viewerIsOwner && !viewerIsAdmin) {
    notFound();
  }
  const hasPurchases = await packageHasPurchases(pkg.owner, pkg.name);

  const catalog = await getCatalog();
  const creator = await catalog.creator(owner);

  const activeTab: TabId = (TABS.find((t) => t.id === rawTab)?.id ?? "readme");
  const { manifest } = pkg;

  // Single access gate shared with the download route, the raw-file API, and the
  // file-viewer page (B2) — `isFree`/`isOwner`/`owns` keep their old names so the
  // rest of this component (including the BuyButton branch below) reads exactly
  // as before.
  const session = await auth();
  const access = await resolveAccess(pkg, session);
  const { isFree, isOwner } = access;
  const owns = access.canDownload;

  const starsEnabled = isDbEnabled();
  const starred = session?.user?.id ? await isStarred(session.user.id, owner, name) : false;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/u/${owner}`} className="font-mono text-fg-muted hover:text-fg">
            {owner}
          </Link>
          <span className="text-fg-subtle">/</span>
          <span className="font-mono text-fg">{name}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-fg">{manifest.title}</h1>
          <KindBadge kind={manifest.kind} />
          <PricingBadge pricing={manifest.pricing} />
          <StatusBadge status={pkg.status} />
          <ReportButton owner={owner} name={name} />
        </div>
        <p className="mt-2 max-w-2xl text-sm text-fg-muted">{manifest.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
          <span className="font-mono">v{manifest.version}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{manifest.license}</span>
          {pkg.stats.downloads > 0 && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span>
                {pkg.stats.downloads.toLocaleString()}{" "}
                {pkg.stats.downloads === 1 ? "download" : "downloads"}
              </span>
            </>
          )}
        </div>
        {pkg.status === "deprecated" && (
          <div className="mt-4">
            <DeprecationBanner
              message={pkg.deprecation?.message}
              replacementId={pkg.deprecation?.replacementId}
            />
          </div>
        )}
        {(viewerIsOwner || viewerIsAdmin) && (
          <div className="mt-4">
            <OwnerActions
              owner={owner}
              name={name}
              status={pkg.status}
              featured={pkg.featured}
              deprecationMessage={pkg.deprecation?.message}
              replacementId={pkg.deprecation?.replacementId}
              viewerIsOwner={viewerIsOwner}
              viewerIsAdmin={viewerIsAdmin}
              hasPurchases={hasPurchases}
            />
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          {/* Action row */}
          <div className="mb-6 flex flex-col gap-4">
            {checkout === "success" && (
              <CheckoutConfirmationBanner
                userId={session?.user?.id}
                sessionId={checkoutSessionId}
              />
            )}
            {checkout === "cancelled" && (
              <div className="rounded-lg border border-border bg-surface p-3 text-sm text-fg-muted">
                Checkout was cancelled — no charge was made.
              </div>
            )}
            <InstallBox owner={owner} name={name} runtimes={manifest.runtimes} />
            <div className="flex flex-wrap items-center gap-3">
              <StarButton
                owner={owner}
                name={name}
                initialStars={pkg.stats.stars}
                initialStarred={starred}
                signedIn={Boolean(session?.user?.id)}
                enabled={starsEnabled}
              />
              {isFree ? (
                <a
                  href={`/api/v1/packages/${owner}/${name}/download`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong"
                >
                  Download .tgz
                </a>
              ) : owns ? (
                <>
                  <a
                    href={`/api/v1/packages/${owner}/${name}/download`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
                  >
                    Download .tgz
                  </a>
                  {!isOwner && <span className="text-xs text-fg-subtle">You own this package.</span>}
                </>
              ) : (
                <BuyButton
                  owner={owner}
                  name={name}
                  label={`Buy — ${formatPrice(manifest.pricing.amountCents, manifest.pricing.currency)}`}
                />
              )}
            </div>
          </div>

          {/* Tabs */}
          <div role="tablist" aria-label="Package details" className="flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={t.id === "readme" ? `/p/${owner}/${name}` : `/p/${owner}/${name}?tab=${t.id}`}
                role="tab"
                aria-selected={activeTab === t.id}
                aria-current={activeTab === t.id ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${
                  activeTab === t.id
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>

          <div className="py-6">
            {activeTab === "readme" && <ReadmeTab owner={owner} name={name} readme={pkg.readme} />}
            {activeTab === "files" && (
              <FilesTab owner={owner} name={name} files={pkg.files} canReadFile={access.canReadFile} />
            )}
            {activeTab === "manifest" && <ManifestTab manifest={manifest} />}
            {activeTab === "versions" && (
              <VersionsTab
                owner={owner}
                name={name}
                entry={manifest.entry}
                canDownload={owns}
                canReadEntry={access.canReadFile(manifest.entry)}
                versions={pkg.versions}
              />
            )}
            {activeTab === "reviews" && (
              <ReviewsTab owner={owner} name={name} isOwner={isOwner} userId={session?.user?.id} userHandle={session?.user?.handle} />
            )}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-72">
          <div className="flex flex-col gap-6">
            {manifest.tags.length > 0 && (
              <SidebarSection title="Tags">
                <ul className="flex flex-wrap gap-1.5">
                  {manifest.tags.map((tag) => (
                    <li key={tag}>
                      <Link
                        href={`/explore?tag=${encodeURIComponent(tag)}`}
                        className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
                      >
                        {tag}
                      </Link>
                    </li>
                  ))}
                </ul>
              </SidebarSection>
            )}

            <SidebarSection title="Runtimes">
              <RuntimeChips runtimes={manifest.runtimes} linkable />
            </SidebarSection>

            <SidebarSection title="Stats">
              <StatsPanel
                owner={owner}
                name={name}
                stats={pkg.stats}
                updatedAt={pkg.updatedAt}
                source={pkg.source}
              />
            </SidebarSection>

            <SidebarSection title="Creator">
              <Link
                href={`/u/${owner}`}
                className="flex items-center gap-2 rounded-md border border-border p-3 hover:border-border-strong"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-hover text-sm text-fg-muted">
                  {(creator?.displayName ?? owner).slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">
                    {creator?.displayName ?? owner}
                  </span>
                  <span className="block truncate font-mono text-xs text-fg-subtle">
                    @{owner}
                  </span>
                </span>
              </Link>
              {creator?.bio && <p className="mt-2 text-sm text-fg-muted">{creator.bio}</p>}
              {creator?.url && (
                <a
                  href={creator.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1.5 block truncate text-xs text-accent hover:text-accent-hover"
                >
                  {creator.url.replace(/^https?:\/\//, "")}
                </a>
              )}
              {(pkg.stats.stars > 0 || pkg.stats.downloads > 0 || pkg.stats.ratingCount) && (
                <dl className="mt-3 flex flex-col gap-1.5 text-sm">
                  {pkg.stats.stars > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-fg-muted">Stars</dt>
                      <dd className="font-mono text-fg">{pkg.stats.stars.toLocaleString()}</dd>
                    </div>
                  )}
                  {pkg.stats.downloads > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-fg-muted">Downloads</dt>
                      <dd className="font-mono text-fg">{pkg.stats.downloads.toLocaleString()}</dd>
                    </div>
                  )}
                  {pkg.stats.ratingCount ? (
                    <div className="flex items-center justify-between">
                      <dt className="text-fg-muted">Rating</dt>
                      <dd>
                        <RatingStars average={pkg.stats.ratingAverage} count={pkg.stats.ratingCount} />
                      </dd>
                    </div>
                  ) : null}
                </dl>
              )}
            </SidebarSection>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </h2>
      {children}
    </div>
  );
}

function ReadmeTab({ owner, name, readme }: { owner: string; name: string; readme: string }) {
  if (!readme.trim()) {
    return <p className="text-sm text-fg-muted">This package has no README.</p>;
  }
  // owner/name let relative README links and images resolve to the package files.
  return <Markdown content={readme} owner={owner} name={name} />;
}

async function FilesTab({
  owner,
  name,
  files,
  canReadFile,
}: {
  owner: string;
  name: string;
  files: { path: string; size: number }[];
  canReadFile: (path: string) => boolean;
}) {
  // The manifest's own file list never includes itself or the README (B15),
  // even though both are always servable (they're the preview paths on a paid
  // package) — surface them here so the manifest is discoverable from the
  // Files tab instead of only by guessing the URL. Most DB-backed packages
  // already store them as regular files; only add what's missing.
  const wellKnown = ["openagent.yaml", "README.md"];
  const missing = wellKnown.filter((p) => !files.some((f) => f.path === p));
  let extra: { path: string; size: number }[] = [];
  if (missing.length > 0) {
    const catalog = await getCatalog();
    const found = await Promise.all(missing.map((p) => catalog.getFile(owner, name, p)));
    extra = found
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .map((f) => ({ path: f.path, size: f.size }));
  }
  const allFiles = [...files, ...extra];

  if (allFiles.length === 0) {
    return <p className="text-sm text-fg-muted">No files listed.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left">
            <th className="px-4 py-2 font-medium text-fg-muted">Path</th>
            <th className="px-4 py-2 font-medium text-fg-muted">Size</th>
          </tr>
        </thead>
        <tbody>
          {allFiles.map((file) => {
            const locked = !canReadFile(file.path);
            return (
              <tr key={file.path} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <Link
                    href={`/p/${owner}/${name}/files/${file.path}`}
                    className="font-mono text-accent hover:text-accent-hover"
                  >
                    {file.path}
                  </Link>
                  {locked && (
                    <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-subtle">
                      Locked
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-fg-subtle">{formatBytes(file.size)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ManifestTab({
  manifest,
}: {
  manifest: import("@/lib/types").Manifest;
}) {
  const rows: [string, string][] = [
    ["schema", String(manifest.schema)],
    ["name", manifest.name],
    ["owner", manifest.owner],
    ["version", manifest.version],
    ["kind", manifest.kind],
    ["license", manifest.license],
    ["entry", manifest.entry],
    ["runtimes", manifest.runtimes.join(", ")],
    ["tags", manifest.tags.join(", ") || "—"],
    [
      "pricing",
      manifest.pricing.model === "free"
        ? "free"
        : `${manifest.pricing.model} · ${(manifest.pricing.amountCents / 100).toFixed(2)} ${manifest.pricing.currency}`,
    ],
  ];
  if (manifest.homepage) rows.push(["homepage", manifest.homepage]);
  if (manifest.repository) rows.push(["repository", manifest.repository]);

  return (
    <div className="flex flex-col gap-8">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([key, value]) => (
              <tr key={key} className="border-b border-border last:border-0">
                <td className="w-40 shrink-0 bg-surface px-4 py-2 font-mono text-xs text-fg-subtle">
                  {key}
                </td>
                <td className="px-4 py-2 font-mono text-fg">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {manifest.inputs.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">Inputs</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left">
                  <th className="px-4 py-2 font-medium text-fg-muted">Name</th>
                  <th className="px-4 py-2 font-medium text-fg-muted">Type</th>
                  <th className="px-4 py-2 font-medium text-fg-muted">Required</th>
                  <th className="px-4 py-2 font-medium text-fg-muted">Description</th>
                </tr>
              </thead>
              <tbody>
                {manifest.inputs.map((input) => (
                  <tr key={input.name} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono text-fg">{input.name}</td>
                    <td className="px-4 py-2 font-mono text-fg-subtle">{input.type}</td>
                    <td className="px-4 py-2 text-fg-muted">{input.required ? "Yes" : "No"}</td>
                    <td className="px-4 py-2 text-fg-muted">{input.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {manifest.requires.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">Requires</h3>
          <ul className="flex flex-col gap-1">
            {manifest.requires.map((req) => (
              <li key={req} className="font-mono text-sm text-fg-muted">
                {req}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function VersionsTab({
  owner,
  name,
  entry,
  canDownload,
  canReadEntry,
  versions,
}: {
  owner: string;
  name: string;
  /** `manifest.entry` — used for the per-version "Files" link (S4/G-V1). */
  entry: string;
  /** Whether the viewer may fetch a tarball at all (paywall gate). */
  canDownload: boolean;
  /** Whether the viewer may read `entry` specifically (preview paths on a
   *  paid package stay readable even when `canDownload` is false). */
  canReadEntry: boolean;
  versions: { version: string; publishedAt: string; changelog?: string }[];
}) {
  if (versions.length === 0) {
    return <p className="text-sm text-fg-muted">No version history available.</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {versions.map((v) => (
        <li key={v.version} className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-semibold text-fg">v{v.version}</span>
            <span className="text-xs text-fg-subtle">
              {new Date(v.publishedAt).toLocaleDateString()}
            </span>
          </div>
          {v.changelog && <p className="mt-1.5 text-sm text-fg-muted">{v.changelog}</p>}
          {/* Per-version actions (S4/G-V1). The Files link points at the raw-file
              API rather than the file-viewer page — that page is owned by
              another workstream and doesn't take a `?version=` param yet. */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {canDownload && (
              <a
                href={`/api/v1/packages/${owner}/${name}/versions/${v.version}/download`}
                className="font-medium text-accent hover:underline"
              >
                Download
              </a>
            )}
            {canReadEntry && (
              <a
                href={`/api/v1/packages/${owner}/${name}/files/${entry}?version=${v.version}`}
                className="text-fg-muted hover:text-fg hover:underline"
              >
                Files
              </a>
            )}
          </div>
          <p className="mt-2 rounded-md bg-surface-hover px-2 py-1 font-mono text-xs text-fg-muted">
            npx openagents add {owner}/{name}@{v.version}
          </p>
        </li>
      ))}
    </ul>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
