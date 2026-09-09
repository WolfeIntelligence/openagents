import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The seed catalog and docs are read from disk at request time; make sure
  // Vercel's serverless bundles include them.
  outputFileTracingIncludes: {
    "/*": ["catalog/**/*", "src/content/docs/**/*"],
  },
};

export default nextConfig;
