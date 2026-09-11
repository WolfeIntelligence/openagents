import { headers } from "next/headers";
import { escapeForScriptTag } from "@/lib/seo";

/**
 * Renders arbitrary JSON-LD as `<script type="application/ld+json">`.
 *
 * A separate stream is adding a nonce-based CSP (a `getNonce()` helper that
 * reads the `x-nonce` request header via `headers()`). Rather than import
 * that helper — which doesn't exist in this worktree yet — this reads the
 * same header directly, so the script tag is CSP-safe as soon as that stream
 * lands without either side needing to import from the other.
 */
export async function JsonLd({ data }: { data: unknown }) {
  let nonce: string | undefined;
  try {
    const headerList = await headers();
    nonce = headerList.get("x-nonce") ?? undefined;
  } catch {
    // headers() throws when called outside a request scope (e.g. a fully
    // static render with no dynamic APIs anywhere on the page) — render
    // without a nonce rather than fail the page over structured data.
  }

  // Escaped so a package title/summary/etc. containing the literal substring
  // "</script" can't break out of the tag early.
  const json = escapeForScriptTag(JSON.stringify(data));

  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // Structured data, not user-facing markup — this is the documented way
      // to emit a raw JSON-LD script body from a React server component.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
