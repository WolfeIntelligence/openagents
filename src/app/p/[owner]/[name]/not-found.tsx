import Link from "next/link";
import { headers } from "next/headers";
import { getCatalog } from "@/lib/catalog";
import { PackageCard } from "@/components/PackageCard";
import type { PackageSummary } from "@/lib/types";

// Segment-level 404 for /p/[owner]/[name]: keeps the real 404 status but, like
// the search box's typo correction, offers the closest packages instead of a
// dead end. The requested path comes from the proxy's `x-pathname` header
// because not-found pages receive no params.
export default async function PackageNotFound() {
  const requested = (await headers()).get("x-pathname") ?? "";
  const match = requested.match(/^\/p\/([^/]+)\/([^/?#]+)/);
  const owner = match?.[1] ?? "";
  const name = match?.[2] ?? "";

  let suggestions: PackageSummary[] = [];
  if (name) {
    try {
      const catalog = await getCatalog();
      const page = await catalog.list({ q: name.replace(/-/g, " "), limit: 3 });
      suggestions = page.items;
    } catch {
      suggestions = [];
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <p className="font-mono text-xs uppercase tracking-wide text-fg-subtle">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-fg">Package not found</h1>
      <p className="mt-2 text-sm text-fg-muted">
        {owner && name ? (
          <>
            There is no package at{" "}
            <span className="font-mono text-fg">
              {owner}/{name}
            </span>
            . It may have been renamed, unlisted, or never existed.
          </>
        ) : (
          "That package does not exist."
        )}
      </p>
      {suggestions.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            Did you mean
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {suggestions.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        </section>
      )}
      <div className="mt-8 flex gap-3 text-sm">
        <Link
          href="/explore"
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg hover:bg-accent-hover"
        >
          Explore packages
        </Link>
        <Link
          href="/"
          className="rounded-md border border-border px-3 py-1.5 text-fg hover:border-border-strong"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
