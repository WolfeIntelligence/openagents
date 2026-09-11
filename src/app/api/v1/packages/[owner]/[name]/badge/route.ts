import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { escapeXml, formatBadgeCount } from "@/lib/seo";
import { notFoundJson, withCors } from "@/lib/api";

export const runtime = "nodejs";

type BadgeType = "version" | "downloads" | "stars" | "rating";
const BADGE_TYPES: readonly BadgeType[] = ["version", "downloads", "stars", "rating"];

// Shields.io-ish per-type value color; label segment is always the same gray.
const VALUE_COLOR: Record<BadgeType, string> = {
  version: "#3178c6",
  downloads: "#4c9a2a",
  stars: "#dfb317",
  rating: "#e05d44",
};

/** Approximate Verdana-11px glyph width, matching shields.io's own badge math
 *  closely enough that labels/values don't look cramped or overly padded. */
const CHAR_WIDTH = 6.5;
const H_PADDING = 10;
const HEIGHT = 20;

function segmentWidth(text: string): number {
  return Math.round(text.length * CHAR_WIDTH + H_PADDING * 2);
}

/** A flat, two-segment shields-style SVG badge: gray label segment, colored
 *  value segment. */
function buildBadgeSvg(label: string, value: string, color: string): string {
  const labelWidth = segmentWidth(label);
  const valueWidth = segmentWidth(value);
  const totalWidth = labelWidth + valueWidth;
  const labelX = labelWidth / 2;
  const valueX = labelWidth + valueWidth / 2;
  const safeLabel = escapeXml(label);
  const safeValue = escapeXml(value);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${HEIGHT}" role="img" aria-label="${safeLabel}: ${safeValue}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="${HEIGHT}" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="${HEIGHT}" fill="${color}"/>
    <rect width="${totalWidth}" height="${HEIGHT}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelX}" y="14">${safeLabel}</text>
    <text x="${valueX}" y="14">${safeValue}</text>
  </g>
</svg>`;
}

function svgResponse(svg: string): Response {
  return withCors(
    new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=300",
      },
    }),
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const { owner, name } = await params;
  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);
  if (!pkg) return notFoundJson();

  const rawType = request.nextUrl.searchParams.get("type");
  // Unknown/missing `type` falls back to "version" rather than erroring — a
  // typo'd query param shouldn't break someone's README badge.
  const type: BadgeType = (BADGE_TYPES as readonly string[]).includes(rawType ?? "")
    ? (rawType as BadgeType)
    : "version";

  let value: string;
  switch (type) {
    case "downloads":
      value = formatBadgeCount(pkg.stats.downloads);
      break;
    case "stars":
      value = formatBadgeCount(pkg.stats.stars);
      break;
    case "rating":
      value = pkg.stats.ratingCount
        ? `${pkg.stats.ratingAverage!.toFixed(1)} (${pkg.stats.ratingCount})`
        : "unrated";
      break;
    case "version":
    default:
      value = `v${pkg.manifest.version}`;
      break;
  }

  return svgResponse(buildBadgeSvg(type, value, VALUE_COLOR[type]));
}
