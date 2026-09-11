// SEO helpers shared by the package page's structured data, the badge SVG
// route, and /feed.xml. Kept dependency-free (no Next.js runtime imports) so
// it can be unit tested directly with node's test runner the same way
// src/lib/format.ts is — see src/lib/__tests__/seo.test.ts.

import type { Package, Creator } from "@/lib/types";
import { absoluteUrl } from "@/lib/site";

/**
 * Escapes the five XML predefined entities. Shared by the RSS feed (item
 * titles/links/descriptions) and the badge SVG route (label/value text) —
 * anywhere untrusted text (a package title, summary, or owner handle) gets
 * interpolated into XML/SVG markup.
 */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return ch;
    }
  });
}

/**
 * Escapes `</script` sequences so a JSON blob embedded in a `<script>` tag
 * can't be broken out of early by a value containing that literal substring
 * (e.g. a package summary that happens to mention a script tag). Used by
 * `<JsonLd>` around `JSON.stringify(data)`.
 */
export function escapeForScriptTag(json: string): string {
  return json.replace(/<\/script/gi, "<\\/script");
}

/**
 * Shields.io-style compact count formatting for badge values: 1200 -> "1.2k",
 * 3_400_000 -> "3.4M". Values under 1000 render as a plain integer. Trailing
 * ".0" is dropped (1000 -> "1k", not "1.0k").
 */
export function formatBadgeCount(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.trunc(n));

  const units: [number, string][] = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "k"],
  ];
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) {
      const scaled = n / threshold;
      const rounded = (Math.round(scaled * 10) / 10).toFixed(1).replace(/\.0$/, "");
      return `${rounded}${suffix}`;
    }
  }
  return String(n);
}

export interface SoftwareSourceCodeInput {
  pkg: Package;
  /** The package owner's creator profile, when known — drives `author.name`/
   *  `author.url`. Falls back to the bare handle when absent (seed packages,
   *  or a lookup that failed). */
  creator?: Creator | null;
}

/**
 * Builds a schema.org `SoftwareSourceCode` JSON-LD object for a package
 * detail page. Rendered by `<JsonLd data={...} />` as a
 * `<script type="application/ld+json">`.
 */
export function buildSoftwareSourceCodeLd({ pkg, creator }: SoftwareSourceCodeInput): Record<string, unknown> {
  const { manifest } = pkg;
  const url = absoluteUrl(`/p/${pkg.owner}/${pkg.name}`);
  const isPaid = manifest.pricing.model !== "free" && manifest.pricing.amountCents > 0;

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: manifest.title,
    description: manifest.summary,
    url,
    codeRepository: manifest.repository || url,
    programmingLanguage: "Markdown",
    license: manifest.license,
    version: manifest.version,
    dateModified: pkg.updatedAt,
    author: {
      "@type": "Person",
      name: creator?.displayName ?? pkg.owner,
      url: creator?.url || absoluteUrl(`/u/${pkg.owner}`),
    },
  };

  if (pkg.stats.ratingCount) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: pkg.stats.ratingAverage,
      ratingCount: pkg.stats.ratingCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  if (isPaid) {
    data.offers = {
      "@type": "Offer",
      price: (manifest.pricing.amountCents / 100).toFixed(2),
      priceCurrency: manifest.pricing.currency.toUpperCase(),
    };
  }

  return data;
}
