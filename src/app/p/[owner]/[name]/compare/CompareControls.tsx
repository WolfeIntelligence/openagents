"use client";

// From/to version pickers and the split/unified toggle for the compare page.
// A client component (unlike the file-viewer's server-rendered `?view=`
// links) because a from x to picker over an arbitrary version list can't be
// enumerated as a fixed set of links the way a two-way toggle can.

import { useRouter } from "next/navigation";

interface CompareControlsProps {
  owner: string;
  name: string;
  versions: { version: string }[];
  from: string;
  to: string;
  view: "split" | "unified";
}

export function CompareControls({ owner, name, versions, from, to, view }: CompareControlsProps) {
  const router = useRouter();

  function navigate(next: { from?: string; to?: string; view?: "split" | "unified" }) {
    const params = new URLSearchParams({
      from: next.from ?? from,
      to: next.to ?? to,
      view: next.view ?? view,
    });
    router.push(`/p/${owner}/${name}/compare?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-fg-muted">From</span>
        <select
          value={from}
          onChange={(e) => navigate({ from: e.target.value })}
          aria-label="Compare from version"
          className="rounded-md border border-border bg-bg-elevated px-2 py-1 font-mono text-xs text-fg"
        >
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version}
            </option>
          ))}
        </select>
      </label>
      <span className="text-fg-subtle" aria-hidden="true">
        &rarr;
      </span>
      <label className="flex items-center gap-1.5">
        <span className="text-fg-muted">To</span>
        <select
          value={to}
          onChange={(e) => navigate({ to: e.target.value })}
          aria-label="Compare to version"
          className="rounded-md border border-border bg-bg-elevated px-2 py-1 font-mono text-xs text-fg"
        >
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version}
            </option>
          ))}
        </select>
      </label>

      <div className="ml-auto flex items-center rounded-md border border-border p-0.5 text-xs">
        <button
          type="button"
          onClick={() => navigate({ view: "unified" })}
          aria-current={view === "unified" ? "page" : undefined}
          className={`rounded px-2 py-1 font-medium ${
            view === "unified" ? "bg-accent-muted text-accent" : "text-fg-muted hover:text-fg"
          }`}
        >
          Unified
        </button>
        <button
          type="button"
          onClick={() => navigate({ view: "split" })}
          aria-current={view === "split" ? "page" : undefined}
          className={`rounded px-2 py-1 font-medium ${
            view === "split" ? "bg-accent-muted text-accent" : "text-fg-muted hover:text-fg"
          }`}
        >
          Split
        </button>
      </div>
    </div>
  );
}
