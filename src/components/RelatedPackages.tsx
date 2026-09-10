import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { KindBadge } from "@/components/KindBadge";
import { PricingBadge } from "@/components/PricingBadge";
import type { PackageSummary } from "@/lib/types";

// G-C2: "Similar packages" (shared tags, same kind first) and "More from
// @owner" on the package detail page sidebar. Server component — one extra
// round trip per tag plus one for the owner's other packages, all run
// concurrently; the catalog is small enough that this is cheap in both
// seed and DB mode. Renders nothing when there's nothing to show, so the
// caller (the sidebar in src/app/p/[owner]/[name]/page.tsx) can always
// mount it unconditionally.

const MAX_SIMILAR = 4;
const MAX_FROM_OWNER = 3;
/** Cap on how many candidates a single shared tag can contribute — keeps this
 *  bounded even for a tag used by most of the catalog. */
const CANDIDATES_PER_TAG = 24;

export async function RelatedPackages({ owner, name }: { owner: string; name: string }) {
  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);
  if (!pkg) return null;

  const selfId = `${owner}/${name}`;
  const tags = pkg.manifest.tags;

  const [tagPages, ownerPage] = await Promise.all([
    Promise.all(tags.map((tag) => catalog.list({ tag, limit: CANDIDATES_PER_TAG }))),
    catalog.list({ owner, limit: MAX_FROM_OWNER + 1, sort: "updated" }),
  ]);

  // One candidate per package id, keeping the highest shared-tag count seen
  // across all of this package's tags (a package sharing 3 tags should rank
  // above one sharing 1, not just be deduped arbitrarily).
  const candidates = new Map<string, { item: PackageSummary; shared: number }>();
  for (const page of tagPages) {
    for (const item of page.items) {
      if (item.id === selfId) continue;
      const shared = item.tags.filter((t) => tags.includes(t)).length;
      const existing = candidates.get(item.id);
      if (!existing || shared > existing.shared) candidates.set(item.id, { item, shared });
    }
  }

  const similar = Array.from(candidates.values())
    .sort((a, b) => {
      if (b.shared !== a.shared) return b.shared - a.shared;
      const sameKind = Number(b.item.kind === pkg.manifest.kind) - Number(a.item.kind === pkg.manifest.kind);
      if (sameKind !== 0) return sameKind;
      return b.item.updatedAt.localeCompare(a.item.updatedAt);
    })
    .slice(0, MAX_SIMILAR)
    .map((c) => c.item);

  const moreFromOwner = ownerPage.items.filter((item) => item.id !== selfId).slice(0, MAX_FROM_OWNER);

  if (similar.length === 0 && moreFromOwner.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      {similar.length > 0 && <RelatedSection title="Similar packages" items={similar} />}
      {moreFromOwner.length > 0 && (
        <RelatedSection title={`More from @${owner}`} items={moreFromOwner} />
      )}
    </div>
  );
}

function RelatedSection({ title, items }: { title: string; items: PackageSummary[] }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/p/${item.owner}/${item.name}`}
              className="flex flex-col gap-0.5 rounded-md border border-border p-2.5 transition-colors hover:border-border-strong hover:bg-surface-hover"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-fg">{item.title}</span>
                <PricingBadge pricing={item.pricing} className="shrink-0" />
              </span>
              <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
                <KindBadge kind={item.kind} />
                <span className="truncate font-mono">
                  {item.owner}/{item.name}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
