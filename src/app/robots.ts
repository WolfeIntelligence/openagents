import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/api/v1/"],
      // The public API is meant to be machine-read; only ops and account surfaces are private.
      disallow: ["/api/cron/", "/api/webhooks/", "/api/checkout", "/api/billing/", "/admin", "/settings/", "/dashboard", "/purchases", "/stars"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
