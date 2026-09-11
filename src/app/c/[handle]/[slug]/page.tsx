import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildInstallAllCommand, getCollection } from "@/lib/collections";
import { getCatalog } from "@/lib/catalog";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { cliSpec } from "@/lib/site";
import { PackageCard } from "@/components/PackageCard";
import { CopyButton } from "@/components/CopyButton";
import { CollectionEditor } from "@/components/CollectionEditor";
import type { Package, PackageSummary } from "@/lib/types";

interface Params {
  handle: string;
  slug: string;
}

/** `catalog.get()` returns the full `Package` (manifest nested); `PackageCard`
 *  wants the flattened `PackageSummary` shape `catalog.list()`/`.featured()`
 *  already produce. Mirrors that flattening for the one-off lookups this page
 *  does per item. */
function toSummary(pkg: Package): PackageSummary {
  return {
    id: pkg.id,
    owner: pkg.owner,
    name: pkg.name,
    stats: pkg.stats,
    featured: pkg.featured,
    status: pkg.status,
    deprecation: pkg.deprecation,
    source: pkg.source,
    updatedAt: pkg.updatedAt,
    title: pkg.manifest.title,
    summary: pkg.manifest.summary,
    kind: pkg.manifest.kind,
    tags: pkg.manifest.tags,
    runtimes: pkg.manifest.runtimes,
    pricing: pkg.manifest.pricing,
    version: pkg.manifest.version,
    license: pkg.manifest.license,
  };
}

async function loadVisible(handle: string, slug: string) {
  const collection = await getCollection(handle, slug);
  if (!collection) return null;

  if (!collection.isPublic) {
    const requester = await getRequester();
    const owner = requester?.id === collection.ownerUserId;
    if (!owner && !(await isAdmin(requester))) return null;
  }

  return collection;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle, slug } = await params;
  const collection = await loadVisible(handle, slug);
  if (!collection) return { title: "Collection" };
  return {
    title: collection.title,
    description: collection.description ?? `A collection of packages by @${collection.owner}.`,
  };
}

export default async function CollectionPage({ params }: { params: Promise<Params> }) {
  const { handle, slug } = await params;
  const collection = await loadVisible(handle, slug);
  if (!collection) notFound();

  const requester = await getRequester();
  const canManage = requester?.id === collection.ownerUserId || (await isAdmin(requester));

  const catalog = await getCatalog();
  const packages = await Promise.all(collection.items.map((item) => catalog.get(item.owner, item.name)));
  const packageByKey = new Map<string, Package>();
  collection.items.forEach((item, i) => {
    const pkg = packages[i];
    if (pkg) packageByKey.set(`${item.owner}/${item.name}`, pkg);
  });

  const installAll = buildInstallAllCommand(collection.items, cliSpec());

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{collection.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            by{" "}
            <Link href={`/u/${collection.owner}`} className="font-mono text-accent hover:text-accent-hover">
              @{collection.owner}
            </Link>
            {!collection.isPublic && (
              <span className="ml-2 rounded-full border border-border-strong px-2 py-0.5 text-xs text-fg-subtle">
                Private
              </span>
            )}
          </p>
          {collection.description && (
            <p className="mt-3 max-w-2xl text-sm text-fg-muted">{collection.description}</p>
          )}
        </div>

        {installAll && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <code className="max-w-xs truncate font-mono text-xs text-fg">{installAll}</code>
            <CopyButton value={installAll} label="Copy install-all" />
          </div>
        )}
      </div>

      {canManage && (
        <div className="mt-6">
          <CollectionEditor
            handle={collection.owner}
            slug={collection.slug}
            initialIsPublic={collection.isPublic}
            initialItems={collection.items.map((item) => ({
              ...item,
              title: packageByKey.get(`${item.owner}/${item.name}`)?.manifest.title,
            }))}
          />
        </div>
      )}

      <div className="mt-8">
        {collection.items.length === 0 ? (
          <p className="text-sm text-fg-muted">This collection has no packages yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collection.items.map((item) => {
              const pkg = packageByKey.get(`${item.owner}/${item.name}`);
              if (!pkg) {
                return (
                  <div
                    key={`${item.owner}/${item.name}`}
                    className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-4 text-sm text-fg-subtle"
                  >
                    <span className="font-mono">
                      {item.owner}/{item.name}
                    </span>
                    <span>No longer available.</span>
                  </div>
                );
              }
              return (
                <div key={`${item.owner}/${item.name}`} className="flex flex-col gap-2">
                  <PackageCard pkg={toSummary(pkg)} />
                  {item.note && <p className="px-1 text-xs text-fg-muted">{item.note}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
