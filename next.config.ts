import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The seed catalog and docs are read from disk at request time; make sure
  // Vercel's serverless bundles include them.
  outputFileTracingIncludes: {
    "/*": ["catalog/**/*", "src/content/docs/**/*"],
  },

  // Don't advertise the framework via `X-Powered-By: Next.js`.
  poweredByHeader: false,

  // Baseline security headers on every response. No Content-Security-Policy here:
  // react-markdown renders creator-supplied READMEs, and Stripe/Auth.js both need
  // redirect/frame allowances worked out deliberately — that's a separate task, not
  // a default to bolt on here.
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
