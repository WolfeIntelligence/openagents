import type { LintFinding, LintLevel } from "@/lib/readme-lint";

/** One-line, plain-language fix suggestion per lint finding id — shown next to
 *  the finding's own message so the wizard reads as "here's what's wrong, and
 *  here's what to do about it" rather than just a list of complaints. Falls
 *  back to no suggestion for an id this map doesn't know about (e.g. if
 *  readme-lint.ts grows a new check before this map is updated). */
const FIX_SUGGESTIONS: Record<string, string> = {
  "missing-title": 'Add a top-level heading, e.g. "# My Package", as the first line.',
  "missing-usage-section": 'Add an "## Install" or "## Usage" heading with the steps to run this.',
  "missing-example": "Add a fenced code block showing a real invocation or config snippet.",
  "missing-limitations": 'Add a "## Limitations" or "## Caveats" section — even a short one.',
  "summary-length": "Expand past the one-line summary: what does it do, why would someone use it, how.",
  "broken-link": "Fix the path, or remove the link if the file isn't part of this package.",
  "todo-placeholder": 'Replace the "TODO:" with real content, or delete that line.',
  "readme-too-short": "Add more detail — installation, usage, and an example are the usual gaps.",
  "no-runtimes": "List at least one runtime under `runtimes:` in openagent.yaml.",
  "few-tags": "Add a couple more relevant tags under `tags:` in openagent.yaml.",
  "missing-links": "Add `homepage:` or `repository:` to openagent.yaml.",
};

const LEVEL_LABEL: Record<LintLevel, string> = {
  error: "Error",
  warn: "Warning",
  info: "Suggestion",
};

const LEVEL_TONE: Record<LintLevel, string> = {
  error: "border-danger/40 bg-danger/10 text-danger",
  warn: "border-warning/40 bg-warning/10 text-fg",
  info: "border-border-strong text-fg-muted",
};

const LEVEL_ORDER: LintLevel[] = ["error", "warn", "info"];

/** Non-blocking README lint results from `POST /api/v1/validate`, grouped by
 *  level with a fix suggestion per finding — step 2 of `PublishWizard`. */
export function ReadmeLintReport({ lint }: { lint: LintFinding[] }) {
  if (lint.length === 0) {
    return (
      <div className="rounded-md border border-accent-border bg-accent-muted p-3 text-sm text-fg">
        README lint: no issues found.
      </div>
    );
  }

  const sorted = [...lint].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-fg">README lint</h3>
      <ul className="flex flex-col gap-2">
        {sorted.map((finding, i) => (
          <li
            key={`${finding.id}-${i}`}
            className={`rounded-md border p-3 text-sm ${LEVEL_TONE[finding.level]}`}
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-current px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                {LEVEL_LABEL[finding.level]}
              </span>
              <span className="font-medium">{finding.message}</span>
            </div>
            {FIX_SUGGESTIONS[finding.id] && (
              <p className="mt-1 text-xs opacity-80">Fix: {FIX_SUGGESTIONS[finding.id]}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
