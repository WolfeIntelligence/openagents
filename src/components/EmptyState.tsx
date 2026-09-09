import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        className="mb-1 h-9 w-9 text-fg-subtle"
        aria-hidden="true"
      >
        <rect x="3.5" y="6" width="17" height="13" rx="2" />
        <path d="M3.5 10h17M8 3.5v3M16 3.5v3" strokeLinecap="round" />
      </svg>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description ? (
        <p className="max-w-sm text-sm text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
