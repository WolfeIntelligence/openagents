import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The seed catalog and docs are read from disk at request time; make sure
  // Vercel's serverless bundles include them.
  outputFileTracingIncludes: {
    "/*": ["catalog/**/*", "src/content/docs/**/*"],
  },

  // Don't advertise the framework via `X-Powered-By: Next.js`.
  poweredByHeader: false,

  // Baseline security headers on every response, including API routes and static
  // assets. The enforcing, per-request-nonce `Content-Security-Policy` itself
  // (G-O3) is set by `src/proxy.ts` instead of here — a header defined statically
  // in next.config.ts can't embed a fresh nonce per request, and API routes/static
  // assets (excluded from proxy's matcher) have no HTML to nonce in the first
  // place, so they just keep these four.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
