import { listRecentChangelogEntries } from "@/lib/changelog";
import { absoluteUrl, SITE_NAME } from "@/lib/site";
import { escapeXml } from "@/lib/seo";

export const runtime = "nodejs";

// GET /changelog.xml — RSS of the newest published versions across every live
// package (Z3), same data as `/changelog`, optionally filtered by `?owner=`.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner") ?? undefined;
  const entries = await listRecentChangelogEntries({ owner });

  const itemsXml = entries
    .map((entry) => {
      const link = absoluteUrl(`/p/${entry.owner}/${entry.name}`);
      const title = `${entry.owner}/${entry.name} v${entry.version}`;
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(`${entry.owner}/${entry.name}@${entry.version}`)}</guid>
      <description>${escapeXml(entry.changelog ?? "")}</description>
      <pubDate>${new Date(entry.publishedAt).toUTCString()}</pubDate>
      <category>${escapeXml(entry.kind)}</category>
      <author>${escapeXml(entry.owner)}</author>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(SITE_NAME)} Changelog</title>
    <link>${escapeXml(absoluteUrl("/changelog"))}</link>
    <description>What's new across ${escapeXml(SITE_NAME)} packages</description>
    <language>en</language>
${itemsXml}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      // 5-minute cache (contract) — CDN and browser alike.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
