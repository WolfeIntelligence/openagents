"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center sm:px-6 lg:px-8">
      <p className="font-mono text-sm text-danger">Error</p>
      <h1 className="mt-2 text-2xl font-semibold text-fg">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-fg-muted">
        An unexpected error occurred while rendering this page. You can try again, or head back
        home.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-border px-4 py-2 text-sm text-fg hover:border-border-strong"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
