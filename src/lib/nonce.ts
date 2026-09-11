// Reads the per-request CSP nonce that `src/proxy.ts` generates.
//
// Next.js already applies this nonce automatically to its own inline scripts
// (framework bootstrap, page bundles, anything rendered via `<Script nonce>`)
// by parsing it back out of the `Content-Security-Policy` response header — see
// proxy.ts and node_modules/next/dist/docs/.../content-security-policy.md. This
// helper is only for a Server Component that writes its own inline
// `<script>` by hand, most notably `dangerouslySetInnerHTML` JSON-LD: that
// script tag isn't one Next generates, so it needs the `nonce` attribute set
// explicitly or the enforcing CSP's `script-src` will block it.
//
// Not usable outside proxy.ts's matcher (API routes, static assets, and any
// path Proxy didn't run for) since no `x-nonce` header exists there — callers
// should treat `null` as "no CSP nonce for this request" rather than an error.

import { headers } from "next/headers";

export async function getNonce(): Promise<string | null> {
  return (await headers()).get("x-nonce");
}
