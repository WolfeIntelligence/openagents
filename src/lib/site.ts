// The one place that knows this deploy's public URL, plus a couple of other
// site-wide constants shared by the legal pages. Every file that needs an
// absolute URL (metadata, the sitemap, robots.txt, Stripe redirect URLs)
// should go through `siteUrl()`/`absoluteUrl()` rather than hard-coding a
// domain — see docs/AUDIT-2026-09.md B7/S12: `openagents.dev` doesn't
// resolve, so every canonical link, sitemap entry, and og:image was pointing
// at a dead host.

export const SITE_NAME = "OpenAgents";

/** Placeholder contact address used for privacy, support, and legal inquiries until
 *  dedicated mailboxes (privacy@, support@) exist. */
export const CONTACT_EMAIL = "zwolfe42@gmail.com";

/**
 * Resolves this deploy's base URL, in order of preference:
 * 1. `NEXT_PUBLIC_SITE_URL` — an explicit override, trailing slash trimmed.
 * 2. `https://${VERCEL_PROJECT_PRODUCTION_URL}` — the project's stable
 *    production domain, set by Vercel on every deploy of that project.
 * 3. `https://${VERCEL_URL}` — the current deployment's own URL (preview or
 *    production), set by Vercel on every deploy.
 * 4. `http://localhost:3000` — local dev / zero-env fallback.
 *
 * Never throws; safe to call with zero env vars.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionUrl) return `https://${productionUrl}`;

  const deploymentUrl = process.env.VERCEL_URL;
  if (deploymentUrl) return `https://${deploymentUrl}`;

  return "http://localhost:3000";
}

/**
 * What `npx` should run to get the CLI. Once `openagents` is published to npm, set
 * NEXT_PUBLIC_CLI_PACKAGE=openagents and every install snippet becomes
 * `npx openagents ...`; until then the site serves its own tarball (built by
 * scripts/pack-cli.mjs), which npx installs directly from the URL.
 */
export function cliSpec(): string {
  const explicit = process.env.NEXT_PUBLIC_CLI_PACKAGE?.trim();
  if (explicit) return explicit;
  return `${siteUrl()}/cli/openagents.tgz`;
}

/** Joins `path` onto `siteUrl()`, normalizing the slash between them. */
export function absoluteUrl(path: string = "/"): string {
  const base = siteUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
