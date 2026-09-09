import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center sm:px-6 lg:px-8">
      <p className="font-mono text-sm text-fg-subtle">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-fg">Page not found</h1>
      <p className="mt-2 text-sm text-fg-muted">
        The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          Go home
        </Link>
        <Link
          href="/explore"
          className="rounded-md border border-border px-4 py-2 text-sm text-fg hover:border-border-strong"
        >
          Explore packages
        </Link>
      </div>
    </div>
  );
}
