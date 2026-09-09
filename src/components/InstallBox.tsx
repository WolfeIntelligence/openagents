"use client";

import { useState } from "react";
import type { RuntimeId } from "@/lib/types";
import { RUNTIMES, installCommand } from "@/lib/runtimes";
import { CopyButton } from "@/components/CopyButton";

export function InstallBox({
  owner,
  name,
  runtimes,
}: {
  owner: string;
  name: string;
  runtimes: RuntimeId[];
}) {
  const tabs = runtimes.length > 0 ? runtimes : (["generic"] as RuntimeId[]);
  const [active, setActive] = useState<RuntimeId>(tabs[0]);
  const command = installCommand(owner, name, active);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div
        role="tablist"
        aria-label="Install command per runtime"
        className="flex flex-wrap gap-0.5 border-b border-border bg-surface p-1"
      >
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active === id}
            onClick={() => setActive(id)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              active === id
                ? "bg-accent text-accent-fg"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg"
            }`}
          >
            {RUNTIMES[id]?.label ?? id}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 bg-bg-elevated px-4 py-3">
        <code className="overflow-x-auto whitespace-pre font-mono text-sm text-fg">
          {command}
        </code>
        <CopyButton value={command} />
      </div>
    </div>
  );
}
