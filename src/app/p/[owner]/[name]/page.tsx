import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCatalog } from "@/lib/catalog";
import { KindBadge } from "@/components/KindBadge";
import { PricingBadge } from "@/components/PricingBadge";
import { RuntimeChips } from "@/components/RuntimeChips";
import { InstallBox } from "@/components/InstallBox";
import { BuyButton } from "@/components/BuyButton";
import { Markdown } from "@/components/Markdown";

type Params = { owner: string; name: string };
type TabId = "readme" | "files" | "manifest" | "versions";
const TABS: { id: TabId; label: string }[] = [
  { id: "readme", label: "Readme" },
  { id: "files", label: "Files" },
  { id: "manifest", label: "Manifest" },
  { id: "versions", label: "Versions" },
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
  searchParams: Promise<{ tab?: string }>;
}) {
  const { owner, name } = await params;
  const { tab: rawTab } = await searchParams;
  const pkg = await loadPackage(owner, name);
  if (!pkg) notFound();

  const catalog = await getCatalog();
  const creator = await catalog.creator(owner);

  const activeTab: TabId = (TABS.find((t) => t.id === rawTab)?.id ?? "readme");
  const { manifest } = pkg;
  const isFree = manifest.pricing.model === "free" || manifest.pricing.amountCents === 0;

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
        </div>
        <p className="mt-2 max-w-2xl text-sm text-fg-muted">{manifest.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
          <span className="font-mono">v{manifest.version}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{manifest.license}</span>
          <span aria-hidden="true">&middot;</span>
          <span>
            {pkg.stats.stars.toLocaleString()} stars &middot;{" "}
            {pkg.stats.downloads.toLocaleString()} downloads
          </span>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          {/* Action row */}
          <div className="mb-6 flex flex-col gap-4">
            <InstallBox owner={owner} name={name} runtimes={manifest.runtimes} />
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`/api/v1/packages/${owner}/${name}/download`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong"
              >
                Download .tgz
              </a>
              {!isFree && (
                <BuyButton
                  owner={owner}
                  name={name}
                  label={`Buy — ${(manifest.pricing.amountCents / 100).toLocaleString(undefined, {
                    style: "currency",
                    currency: manifest.pricing.currency.toUpperCase(),
                  })}`}
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
            {activeTab === "readme" && <ReadmeTab readme={pkg.readme} />}
            {activeTab === "files" && <FilesTab owner={owner} name={name} files={pkg.files} />}
            {activeTab === "manifest" && <ManifestTab manifest={manifest} />}
            {activeTab === "versions" && <VersionsTab versions={pkg.versions} />}
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
              <dl className="flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Stars</dt>
                  <dd className="font-mono text-fg">{pkg.stats.stars.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Downloads</dt>
                  <dd className="font-mono text-fg">{pkg.stats.downloads.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Updated</dt>
                  <dd className="text-fg">{new Date(pkg.updatedAt).toLocaleDateString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Source</dt>
                  <dd className="text-fg">{pkg.source}</dd>
                </div>
              </dl>
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

function ReadmeTab({ readme }: { readme: string }) {
  if (!readme.trim()) {
    return <p className="text-sm text-fg-muted">This package has no README.</p>;
  }
  return <Markdown content={readme} />;
}

function FilesTab({
  owner,
  name,
  files,
}: {
  owner: string;
  name: string;
  files: { path: string; size: number }[];
}) {
  if (files.length === 0) {
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
          {files.map((file) => (
            <tr key={file.path} className="border-b border-border last:border-0">
              <td className="px-4 py-2">
                <Link
                  href={`/p/${owner}/${name}/files/${file.path}`}
                  className="font-mono text-accent hover:text-accent-hover"
                >
                  {file.path}
                </Link>
              </td>
              <td className="px-4 py-2 font-mono text-fg-subtle">{formatBytes(file.size)}</td>
            </tr>
          ))}
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
  versions,
}: {
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
