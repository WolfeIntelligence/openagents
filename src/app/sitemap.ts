import type { MetadataRoute } from "next";
import { getCatalog } from "@/lib/catalog";
import { getAllDocs } from "@/app/docs/docs-source";

const BASE_URL = "https://openagents.dev";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getCatalog();
  const [packages, docs] = await Promise.all([
    catalog.list({ limit: 1000 }),
    Promise.resolve(getAllDocs()),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${BASE_URL}/explore`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/docs`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE_URL}/pricing`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/publish`, changeFrequency: "monthly", priority: 0.5 },
  ];

  const docRoutes: MetadataRoute.Sitemap = docs.map((doc) => ({
    url: `${BASE_URL}/docs/${doc.slug}`,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  const packageRoutes: MetadataRoute.Sitemap = packages.items.map((pkg) => ({
    url: `${BASE_URL}/p/${pkg.owner}/${pkg.name}`,
    lastModified: pkg.updatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...docRoutes, ...packageRoutes];
}
