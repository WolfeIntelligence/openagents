import { ImageResponse } from "next/og";
import { getCatalog } from "@/lib/catalog";
import { KIND_META } from "@/lib/runtimes";
import { formatPrice } from "@/lib/format";
import { cliSpec } from "@/lib/site";
import type { Package } from "@/lib/types";

export const alt = "OpenAgents package";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#09090b";
const FG = "#fafafa";
const MUTED = "#a1a1aa";
const SUBTLE = "#71717a";
const BORDER = "#27272a";
const ELEVATED = "#18181b";
const ACCENT = "#10b981";

/** Truncates to `max` characters on a word boundary, adding an ellipsis —
 *  satori (the renderer behind `ImageResponse`) doesn't reliably support CSS
 *  line-clamping, so the summary is clamped as plain text instead. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : max).trimEnd()}…`;
}

function pricingLabel(pkg: Package): string {
  const { pricing } = pkg.manifest;
  if (pricing.model === "free" || pricing.amountCents === 0) return "Free";
  const amount = formatPrice(pricing.amountCents, pricing.currency);
  return pricing.model === "subscription" ? `${amount}/mo` : amount;
}

/** Shared card chrome (logo wordmark) so the fallback and the real card look
 *  like the same product even when a package can't be found. */
function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="6" r="3.4" fill={ACCENT} />
        <circle cx="6" cy="24" r="3.4" fill={MUTED} />
        <circle cx="26" cy="24" r="3.4" fill={MUTED} />
        <path
          d="M16 9.4 L6 20.6 M16 9.4 L26 20.6 M9.2 24 H22.8"
          stroke={BORDER}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span style={{ fontSize: 22, fontWeight: 700, color: FG }}>OpenAgents</span>
    </div>
  );
}

function FallbackImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BG,
          color: FG,
          fontFamily: "sans-serif",
        }}
      >
        <Wordmark />
        <p style={{ fontSize: 26, color: MUTED, marginTop: 20 }}>Package not found</p>
      </div>
    ),
    { ...size, status: 404 },
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { owner, name } = await params;
  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);

  // 404-safe: an unknown/deleted package still gets a branded image instead
  // of a broken social-share preview.
  if (!pkg) return FallbackImage();

  const { manifest } = pkg;
  const kind = KIND_META[manifest.kind]?.label ?? manifest.kind;
  const price = pricingLabel(pkg);
  const summary = clamp(manifest.summary, 140);
  const installCmd = `npx ${cliSpec()} add ${owner}/${name}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: BG,
          color: FG,
          fontFamily: "sans-serif",
          padding: "56px 64px",
        }}
      >
        {/* Top row: wordmark + kind/price badges */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark />
          <div style={{ display: "flex", gap: 10 }}>
            <span
              style={{
                display: "flex",
                fontSize: 18,
                fontWeight: 600,
                color: MUTED,
                border: `1px solid ${BORDER}`,
                borderRadius: 999,
                padding: "6px 18px",
              }}
            >
              {kind}
            </span>
            <span
              style={{
                display: "flex",
                fontSize: 18,
                fontWeight: 600,
                color: price === "Free" ? MUTED : ACCENT,
                border: `1px solid ${price === "Free" ? BORDER : "#065f46"}`,
                borderRadius: 999,
                padding: "6px 18px",
              }}
            >
              {price}
            </span>
          </div>
        </div>

        {/* Middle: owner/name, title, summary */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
          <span style={{ fontSize: 22, color: SUBTLE, fontFamily: "monospace" }}>
            {owner}/{name}
          </span>
          <span style={{ fontSize: 54, fontWeight: 700, marginTop: 10, lineHeight: 1.1 }}>
            {manifest.title}
          </span>
          <span style={{ fontSize: 26, color: MUTED, marginTop: 16, maxWidth: 980 }}>
            {summary}
          </span>
        </div>

        {/* Bottom: stars/downloads + install command */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 24, fontSize: 22, color: MUTED }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              ★ {pkg.stats.stars.toLocaleString()}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              ↓ {pkg.stats.downloads.toLocaleString()}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "monospace",
              fontSize: 20,
              color: FG,
              backgroundColor: ELEVATED,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: "10px 18px",
            }}
          >
            {installCmd}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
