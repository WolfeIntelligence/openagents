import { ImageResponse } from "next/og";
import { getCatalog } from "@/lib/catalog";
import { getCreatorTotals } from "@/lib/stats";

export const alt = "OpenAgents creator";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#09090b";
const FG = "#fafafa";
const MUTED = "#a1a1aa";
const BORDER = "#27272a";
const ACCENT = "#10b981";

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
        <p style={{ fontSize: 26, color: MUTED, marginTop: 20 }}>Creator not found</p>
      </div>
    ),
    { ...size, status: 404 },
  );
}

export default async function Image({ params }: { params: Promise<{ owner: string }> }) {
  const { owner } = await params;
  const catalog = await getCatalog();
  const creator = await catalog.creator(owner);

  // 404-safe: an unknown handle still gets a branded image instead of a
  // broken social-share preview.
  if (!creator) return FallbackImage();

  const totals = await getCreatorTotals(owner);

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
        <Wordmark />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 96,
                height: 96,
                borderRadius: 999,
                backgroundColor: "#27272a",
                fontSize: 44,
                color: MUTED,
              }}
            >
              {creator.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 52, fontWeight: 700, lineHeight: 1.1 }}>
                {creator.displayName}
              </span>
              <span style={{ fontSize: 26, color: MUTED, marginTop: 6, fontFamily: "monospace" }}>
                @{creator.handle}
              </span>
            </div>
          </div>
          {creator.bio && (
            <span style={{ display: "flex", fontSize: 24, color: MUTED, marginTop: 24, maxWidth: 980 }}>
              {creator.bio}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 32, fontSize: 24, color: MUTED }}>
          <span style={{ display: "flex" }}>
            {creator.packageCount.toLocaleString()} package{creator.packageCount === 1 ? "" : "s"}
          </span>
          <span style={{ display: "flex" }}>{totals.stars.toLocaleString()} stars</span>
          <span style={{ display: "flex" }}>↓ {totals.downloads.toLocaleString()} downloads</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
