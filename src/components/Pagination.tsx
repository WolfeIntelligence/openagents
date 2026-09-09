import Link from "next/link";

interface PaginationProps {
  total: number;
  page: number; // 1-indexed
  pageSize: number;
  /** Current search params (already resolved), used to build page links. */
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}

function buildHref(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "page") continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.set(key, value);
    }
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({ total, page, pageSize, searchParams, basePath }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 border-t border-border pt-4"
    >
      <p className="text-sm text-fg-subtle">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        {prevDisabled ? (
          <span className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-fg-subtle">
            Previous
          </span>
        ) : (
          <Link
            href={buildHref(basePath, searchParams, page - 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:border-border-strong"
          >
            Previous
          </Link>
        )}
        {nextDisabled ? (
          <span className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-fg-subtle">
            Next
          </span>
        ) : (
          <Link
            href={buildHref(basePath, searchParams, page + 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:border-border-strong"
          >
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}
