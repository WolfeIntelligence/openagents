import type { MetadataRoute } from "next";
import { getCatalog } from "@/lib/catalog";
import { getAllDocs } from "@/app/docs/docs-source";
import { CATALOG_ALL_LIMIT } from "@/lib/types";
import { absoluteUrl } from "@/lib/site";
import { listCollections, type CollectionSummary } from "@/lib/collections";

/** Pages through `listCollections` (capped at 100/call) to collect every
 *  public collection for the sitemap. Bails past a generous ceiling so a bug
 *  in pagination can't loop forever. */
async function listAllPublicCollections(): Promise<CollectionSummary[]> {
  const all: CollectionSummary[] = [];
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const { items } = await listCollections({ limit: 100, offset });
    all.push(...items);
    if (items.length < 100) break;
    offset += 100;
  }
  return all;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getCatalog();
  // Explicit ceiling, not the request-facing default — a sitemap needs every
  // package, not one page of them. See CATALOG_ALL_LIMIT.
  const [packages, docs, collections] = await Promise.all([
    catalog.list({ limit: CATALOG_ALL_LIMIT }),
    Promise.resolve(getAllDocs()),
    // Y2: every public collection. `listCollections` caps a single call at
    // 100 (it's also the public-facing API's page size limit), so page
    // through it here rather than assuming one call gets everything.
    listAllPublicCollections(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/explore"), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/docs"), changeFrequency: "weekly", priority: 0.6 },
    { url: absoluteUrl("/pricing"), changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/publish"), changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/privacy"), changeFrequency: "yearly", priority: 0.3 },
    { url: absoluteUrl("/terms"), changeFrequency: "yearly", priority: 0.3 },
  ];

  const docRoutes: MetadataRoute.Sitemap = docs.map((doc) => ({
    url: absoluteUrl(`/docs/${doc.slug}`),
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  const packageRoutes: MetadataRoute.Sitemap = packages.items.map((pkg) => ({
    url: absoluteUrl(`/p/${pkg.owner}/${pkg.name}`),
    lastModified: pkg.updatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  // One entry per distinct owner — creator pages were entirely missing from
  // the sitemap before (S12).
  const owners = Array.from(new Set(packages.items.map((pkg) => pkg.owner))).sort();
  const creatorRoutes: MetadataRoute.Sitemap = owners.map((owner) => ({
    url: absoluteUrl(`/u/${owner}`),
    changeFrequency: "weekly",
    priority: 0.4,
  }));

  const collectionRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/collections"), changeFrequency: "daily", priority: 0.6 },
    ...collections.map((c) => ({
      url: absoluteUrl(`/c/${c.owner}/${c.slug}`),
      lastModified: c.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];

  return [...staticRoutes, ...docRoutes, ...packageRoutes, ...creatorRoutes, ...collectionRoutes];
}
