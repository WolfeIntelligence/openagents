// Enforcing, nonce-based Content-Security-Policy (Y4/G-O3).
//
// `middleware.ts` was renamed to `proxy.ts` in Next 16 (the exported function is
// now named `proxy`, not `middleware`) — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
// and .../01-app/02-guides/content-security-policy.md, which this file follows
// closely: generate a fresh nonce per request, forward it to Next via the
// `x-nonce` request header (Next reads that back out of the CSP response header
// to nonce its own framework/page scripts automatically — no per-page wiring
// needed), and also expose it to Server Components through `getNonce()` in
// `src/lib/nonce.ts` for any hand-written inline `<script>` (e.g. JSON-LD).
//
// Nonce-based CSP requires dynamic rendering (a static shell has no per-request
// nonce to embed) — see the `connection()` call in `src/app/layout.tsx`.
//
// Previously this app shipped `Content-Security-Policy-Report-Only` from
// `next.config.ts` (report, don't block) because Next emitted inline
// bootstrap/hydration scripts with no nonce. That's what this file replaces:
// `next.config.ts` no longer sets any CSP header for page routes, and this
// proxy sets the real, enforcing `Content-Security-Policy` instead.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  // `crypto` is the Web Crypto global (available in both the Node.js and Edge
  // runtimes Proxy can run in) — no import needed.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' is dev-only: React uses `eval` there to reconstruct
    // server-side error stacks in the browser. Never present in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind and Next both emit inline <style>/style attributes with no
    // nonce story of their own, so this stays 'unsafe-inline' (styles can't
    // exfiltrate data or execute code the way scripts can, so this is a much
    // smaller concession than 'unsafe-inline' on script-src would be).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com https://lh3.googleusercontent.com https://*.stripe.com",
    "connect-src 'self' https://api.stripe.com https://*.ingest.sentry.io",
    "frame-src https://js.stripe.com https://checkout.stripe.com",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://github.com https://accounts.google.com",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  // Set on the request too (not just the response) so Next.js can read the
  // CSP header back out during SSR to extract the nonce for its own scripts,
  // per the "How nonces work in Next.js" section of the CSP guide.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Lets segment-level not-found pages know which URL was asked for (e.g. to suggest a package).
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except API routes and static/image assets — those keep
      // only the baseline headers set in next.config.ts, no nonce/CSP (an API
      // response has no HTML to nonce, and static assets are immutable files
      // Proxy shouldn't run on for every request).
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
