import type { ScanFlag, ScanResult, ScanSeverity } from "@/lib/scan";

const SEVERITY_LABEL: Record<ScanSeverity, string> = { high: "High", warn: "Warning", info: "Info" };

// Static per-severity classes (Tailwind needs literal class strings — same
// pattern as StatusBadge/KindBadge's *_STYLES maps).
const SEVERITY_STYLES: Record<ScanSeverity, string> = {
  high: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  warn: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  info: "border-border bg-surface text-fg-muted",
};

const SEVERITY_BADGE_STYLES: Record<ScanSeverity, string> = {
  high: "border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200",
  warn: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-200",
  info: "border-border bg-surface-hover text-fg-muted",
};

/** One-line "why this is flagged" explainer per rule id — shown under each
 *  flag so a publisher unfamiliar with the scanner's rule catalog
 *  (`src/lib/scan.ts`'s doc comment) still understands what tripped it. */
const RULE_EXPLAINERS: Record<string, string> = {
  "injection.override":
    "Text that tries to override an agent's system/developer instructions once it reads this package.",
  "injection.hidden":
    "Content designed to be invisible to a human reviewer but readable by an LLM — hidden characters, bidi overrides, an instruction buried in an HTML comment, or a suspicious base64 blob.",
  "exfil.env":
    "Reads a credential (an SSH key, AWS credentials, an API key) alongside a network call — the shape of sending a secret somewhere.",
  "exfil.network": "A network call to a host outside the trusted allowlist, or to a raw IP address.",
  destructive:
    "A command that destroys data or infrastructure wholesale — e.g. `rm -rf /`, a forced push to main, `DROP DATABASE`.",
  secrets: "What looks like a real credential (an API key, access key, or private key) committed in plain text.",
  obfuscation: "Code that decodes and runs hidden content, e.g. eval() of base64 or a python exec() of base64.",
};

/**
 * Shows a publish's content-scan findings (Z2) — rendered by `PublishForm`
 * after a successful publish, using the `scan` field `publishPackage` now
 * returns on every `PublishResult`. Purely presentational: takes the already-
 * fetched `ScanResult`, fetches nothing itself.
 */
export function ScanReport({ scan }: { scan: ScanResult }) {
  if (scan.flags.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-3 text-sm text-fg-muted">
        Content scan found nothing concerning.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-fg">Content scan: risk score {scan.score}/100</p>
      <ul className="flex flex-col gap-2">
        {scan.flags.map((flag, i) => (
          <FlagRow key={`${flag.id}-${flag.path}-${flag.line}-${i}`} flag={flag} />
        ))}
      </ul>
    </div>
  );
}

function FlagRow({ flag }: { flag: ScanFlag }) {
  return (
    <li className={`rounded-md border p-2.5 text-xs ${SEVERITY_STYLES[flag.severity]}`}>
      <p className="flex flex-wrap items-center gap-1.5 font-medium">
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_BADGE_STYLES[flag.severity]}`}
        >
          {SEVERITY_LABEL[flag.severity]}
        </span>
        {flag.message}
      </p>
      <p className="mt-1 truncate font-mono opacity-80">
        {flag.path}:{flag.line}
      </p>
      <p className="mt-1 truncate font-mono opacity-70">{flag.excerpt}</p>
      {RULE_EXPLAINERS[flag.id] && (
        <p className="mt-1.5 opacity-80">
          <span className="font-medium">Why this is flagged:</span> {RULE_EXPLAINERS[flag.id]}
        </p>
      )}
    </li>
  );
}
