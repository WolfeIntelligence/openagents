import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
          backgroundColor: "#09090b",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="64" height="64" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="6" r="3.4" fill="#10b981" />
            <circle cx="6" cy="24" r="3.4" fill="#a1a1aa" />
            <circle cx="26" cy="24" r="3.4" fill="#a1a1aa" />
            <path
              d="M16 9.4 L6 20.6 M16 9.4 L26 20.6 M9.2 24 H22.8"
              stroke="#3f3f46"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span style={{ fontSize: 56, fontWeight: 700 }}>OpenAgents</span>
        </div>
        <p style={{ fontSize: 28, color: "#a1a1aa", marginTop: 20 }}>
          The open marketplace for agentic workflows
        </p>
      </div>
    ),
    { ...size },
  );
}
