import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The seed catalog and docs are read from disk at request time; make sure
  // Vercel's serverless bundles include them.
  outputFileTracingIncludes: {
    "/*": ["catalog/**/*", "src/content/docs/**/*"],
  },

  // Don't advertise the framework via `X-Powered-By: Next.js`.
  poweredByHeader: false,

  // Baseline security headers on every response, plus a report-only CSP (see G-O3 in
  // docs/AUDIT-2026-09.md). It is Report-Only, not enforcing, for two reasons that
  // are still open:
  //   1. Next.js emits inline bootstrap/hydration <script> tags with no nonce in this
  //      version, so an enforcing `script-src` without 'unsafe-inline' breaks every
  //      page. Switching to enforcing requires wiring a per-request nonce through
  //      `next.config.ts` + a middleware that reads it into `<Script nonce>`, or
  //      waiting on a Next.js version that nonces its own inline scripts automatically.
  //   2. react-markdown renders creator-supplied READMEs; until that output is
  //      audited for injected `<script>`/`on*=` content, flipping this to enforcing
  //      is done together with that audit, not before it.
  // Once both are addressed, rename the header to `Content-Security-Policy` and drop
  // `'unsafe-inline'` from `script-src` (nonces make it unnecessary).
  async headers() {
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline' is required until inline scripts carry a nonce — see comment above.
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      // Tailwind emits inline <style> and style attributes; there is no nonce story
      // for styles in this app, so 'unsafe-inline' stays even after script-src is fixed.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
      "font-src 'self' data:",
      "connect-src 'self' https://api.stripe.com",
      "frame-src https://js.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
