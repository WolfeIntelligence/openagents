import { getCatalog } from "@/lib/catalog";
import { absoluteUrl, SITE_NAME } from "@/lib/site";
import { escapeXml } from "@/lib/seo";

export const runtime = "nodejs";

const FEED_SIZE = 30;
// Fetched before filtering to "live" — deprecated/pending/unlisted packages
// can sort ahead of live ones by `updatedAt`, so over-fetch and trim rather
// than risk returning fewer than FEED_SIZE items when live ones exist.
const FETCH_SIZE = 200;

export async function GET() {
  const catalog = await getCatalog();
  const { items } = await catalog.list({ sort: "updated", limit: FETCH_SIZE });
  const live = items.filter((pkg) => pkg.status === "live").slice(0, FEED_SIZE);

  const itemsXml = live
    .map((pkg) => {
      const link = absoluteUrl(`/p/${pkg.owner}/${pkg.name}`);
      return `    <item>
      <title>${escapeXml(pkg.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <description>${escapeXml(pkg.summary)}</description>
      <pubDate>${new Date(pkg.updatedAt).toUTCString()}</pubDate>
      <category>${escapeXml(pkg.kind)}</category>
      <author>${escapeXml(pkg.owner)}</author>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(absoluteUrl("/"))}</link>
    <description>Newest packages on ${escapeXml(SITE_NAME)}</description>
    <language>en</language>
${itemsXml}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      // 5-minute cache (task spec) — CDN and browser alike.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
