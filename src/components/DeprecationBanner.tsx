import Link from "next/link";

/**
 * Public-facing deprecation notice (G-D3) — rendered on the package page
 * whenever `status === "deprecated"`. `message` and `replacementId` come
 * from `Package.deprecation`, populated by the catalog only in that case.
 */
export function DeprecationBanner({
  message,
  replacementId,
}: {
  message?: string;
  replacementId?: string;
}) {
  return (
    <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
      <p className="font-medium">This package is deprecated.</p>
      {message && <p className="mt-1">{message}</p>}
      {replacementId && (
        <p className="mt-1">
          Consider{" "}
          <Link href={`/p/${replacementId}`} className="font-mono underline hover:no-underline">
            {replacementId}
          </Link>{" "}
          instead.
        </p>
      )}
    </div>
  );
}
