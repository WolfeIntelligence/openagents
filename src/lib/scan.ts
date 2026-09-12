// Publish-time content scanner (Z2). Pure, dependency-free, and safe to unit-test
// directly with `node:test` — no DB, no env, no Next.js imports. Runs against the
// files a publish or GitHub import is about to write, looking for the kinds of
// things that make an "instruction file for an agent with real tool access"
// dangerous to install: prompt-injection attempts aimed at the agent reading the
// package, hidden/invisible manipulation, secret exfiltration, destructive
// commands, and leaked credentials.
//
// Scoring: each matched rule instance adds its severity's weight (high=40,
// warn=15, info=5) to the score, capped at 100. The same rule id counts at most
// twice toward the score (extra instances still appear in `flags`, for a human
// reviewer, but stop moving the needle) — one rule tripping five times on the
// same bad idea shouldn't automatically max out the score the way five
// different rules tripping once each should. `publish.ts` uses the final score
// to decide whether a new package/version needs review (see its own comments).
//
// Rule ids (stable — referenced by `packageVersions.scanFlags`, the admin
// "Flagged uploads" list, and this file's own tests; do not rename one without
// a migration plan):
//   injection.override — "ignore previous instructions"-style attempts to
//     override the agent's system/developer prompt once it reads this package.
//   injection.hidden    — content designed to be invisible to a human skimming
//     the file but readable by an LLM: zero-width characters, RTL/bidi
//     overrides, an HTML comment carrying imperative instructions, or a long
//     base64 blob buried in a markdown file.
//   exfil.env           — a read of a credentials file/env var (SSH keys, AWS
//     credentials, .env, common API key env vars) paired with a network call on
//     the same or next line — the shape of "read a secret, then send it
//     somewhere."
//   exfil.network       — an actual network call (curl/wget/fetch/
//     Invoke-WebRequest) to a host outside a small allowlist (GitHub, this
//     site, common docs hosts) or to a raw IP literal.
//   destructive          — commands that destroy data or infrastructure wholesale:
//     `rm -rf /` or `~`, a force-push to main/master, `DROP DATABASE`,
//     `format c:`, `mkfs`, the classic fork bomb.
//   secrets              — a credential that looks real and shouldn't be
//     committed at all: an AWS access key id, a GitHub token, an OpenAI/
//     Anthropic-shaped `sk-...` key, or a PEM private key block.
//   obfuscation           — code that hides what it does behind a decode step:
//     `eval(...)` of base64-decoded content, or a `python -c "exec(...)"`
//     one-liner unpacking base64.
//
// A false positive found while calibrating these against every seed package
// under catalog/ (see `scan.test.ts`): the naive "you are now" pattern matched
// catalog/openagents/context-compaction/HARNESS.md's "You are now solving a
// subproblem" (ordinary advice prose, not a role-reassignment attempt). Fixed
// by excluding "you are now <verb>ing" continuations — see `YOU_ARE_NOW_RE`
// below — rather than weakening the rule to the point of missing real
// "you are now DAN"/"you are now unrestricted" jailbreak attempts.

export type ScanSeverity = "info" | "warn" | "high";

export interface ScanFlag {
  /** Stable rule id, e.g. "injection.override" — see the module doc comment. */
  id: string;
  severity: ScanSeverity;
  path: string;
  /** 1-based line number within the file. */
  line: number;
  /** The offending line, trimmed and capped, for a human reviewer to read at a glance. */
  excerpt: string;
  message: string;
}

export interface ScanResult {
  /** 0 (clean) .. 100. */
  score: number;
  flags: ScanFlag[];
}

export interface ScanInputFile {
  path: string;
  content: string;
  /** "base64" marks a binary file — skipped entirely, per contract. */
  encoding?: "utf8" | "base64";
}

const SEVERITY_WEIGHT: Record<ScanSeverity, number> = {
  high: 40,
  warn: 15,
  info: 5,
};

const MAX_EXCERPT_CHARS = 160;

function excerptOf(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > MAX_EXCERPT_CHARS ? `${trimmed.slice(0, MAX_EXCERPT_CHARS)}…` : trimmed;
}

// ---------------------------------------------------------------------------
// injection.override
// ---------------------------------------------------------------------------

const IGNORE_INSTRUCTIONS_RE = /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/i;
const DISREGARD_RE = /\bdisregard\s+your\s+(?:system|previous)\b/i;
const DEVELOPER_MODE_RE = /\bdeveloper\s+mode\b/i;
// Excludes "you are now <verb>ing" (e.g. "you are now solving a subproblem") —
// ordinary narrative prose, not a role-reassignment attempt — while still
// catching "you are now DAN", "you are now unrestricted", "you are now in
// developer mode", etc. See the false-positive note in the module doc comment.
const YOU_ARE_NOW_RE = /\byou are now\b(?!\s+\w+ing\b)/i;

function scanInjectionOverride(path: string, line: string, lineNo: number, flags: ScanFlag[]) {
  if (IGNORE_INSTRUCTIONS_RE.test(line)) {
    flags.push({
      id: "injection.override",
      severity: "high",
      path,
      line: lineNo,
      excerpt: excerptOf(line),
      message: "instructs the agent to ignore its prior instructions",
    });
  }
  if (DISREGARD_RE.test(line)) {
    flags.push({
      id: "injection.override",
      severity: "high",
      path,
      line: lineNo,
      excerpt: excerptOf(line),
      message: "instructs the agent to disregard its system/previous prompt",
    });
  }
  if (DEVELOPER_MODE_RE.test(line)) {
    flags.push({
      id: "injection.override",
      severity: "warn",
      path,
      line: lineNo,
      excerpt: excerptOf(line),
      message: `mentions "developer mode" — a common jailbreak framing`,
    });
  }
  if (YOU_ARE_NOW_RE.test(line)) {
    flags.push({
      id: "injection.override",
      severity: "warn",
      path,
      line: lineNo,
      excerpt: excerptOf(line),
      message: `"you are now ..." — possible role-reassignment attempt`,
    });
  }
}

// ---------------------------------------------------------------------------
// injection.hidden
// ---------------------------------------------------------------------------

const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF\u2060]/;
const RTL_OVERRIDE_RE = /[\u202A-\u202E\u2066-\u2069]/;
const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/g;
const IMPERATIVE_IN_COMMENT_RE =
  /\b(ignore|disregard|must|always|secretly|override|do not (?:tell|mention|reveal))\b/i;
// 200+ chars of contiguous base64 alphabet — long enough that it's very
// unlikely to be a stray string and not, say, a short id or hash.
const BASE64_BLOB_RE = /[A-Za-z0-9+/]{200,}={0,2}/;

function scanInjectionHiddenLine(path: string, line: string, lineNo: number, flags: ScanFlag[]) {
  if (ZERO_WIDTH_RE.test(line)) {
    flags.push({
      id: "injection.hidden",
      severity: "warn",
      path,
      line: lineNo,
      excerpt: excerptOf(line),
      message: "contains zero-width characters, often used to hide text from human reviewers",
    });
  }
  if (RTL_OVERRIDE_RE.test(line)) {
    flags.push({
      id: "injection.hidden",
      severity: "high",
      path,
      line: lineNo,
      excerpt: excerptOf(line),
      message: "contains a right-to-left/bidi override character, often used to disguise text",
    });
  }
}

/** Whole-file checks for injection.hidden that don't make sense per-line
 *  (an HTML comment or base64 blob can span how a line-splitter sees things,
 *  and both need the un-split source to report an accurate line number). */
function scanInjectionHiddenWhole(path: string, content: string, flags: ScanFlag[]) {
  for (const match of content.matchAll(HTML_COMMENT_RE)) {
    if (!IMPERATIVE_IN_COMMENT_RE.test(match[1])) continue;
    const lineNo = content.slice(0, match.index ?? 0).split("\n").length;
    flags.push({
      id: "injection.hidden",
      severity: "high",
      path,
      line: lineNo,
      excerpt: excerptOf(match[0]),
      message: "HTML comment carries imperative instructions invisible in rendered markdown",
    });
  }

  if (path.toLowerCase().endsWith(".md")) {
    const match = BASE64_BLOB_RE.exec(content);
    if (match) {
      const lineNo = content.slice(0, match.index).split("\n").length;
      flags.push({
        id: "injection.hidden",
        severity: "info",
        path,
        line: lineNo,
        excerpt: excerptOf(match[0]),
        message: "long base64 blob in a markdown file — verify it isn't hiding encoded instructions",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// exfil.env
// ---------------------------------------------------------------------------

const ENV_TARGET_RE = /(\$HOME\/\.ssh|~\/\.ssh|~\/\.aws|\.env\b|AWS_SECRET\w*|OPENAI_API_KEY|ANTHROPIC_API_KEY)/;
const NETWORK_CALL_RE = /\b(curl|wget|fetch\(|Invoke-WebRequest|axios\.\w+\(|requests\.(?:get|post)\(|http\.request\()/i;

function scanExfilEnv(path: string, lines: string[], i: number, flags: ScanFlag[]) {
  const line = lines[i];
  const targetMatch = ENV_TARGET_RE.exec(line);
  if (!targetMatch) return;

  const nextLine = lines[i + 1] ?? "";
  if (!NETWORK_CALL_RE.test(line) && !NETWORK_CALL_RE.test(nextLine)) return;

  flags.push({
    id: "exfil.env",
    severity: "high",
    path,
    line: i + 1,
    excerpt: excerptOf(line),
    message: `reads a credential (${targetMatch[1]}) alongside a network call — possible exfiltration`,
  });
}

// ---------------------------------------------------------------------------
// exfil.network
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s"'`)<>]+/g;
const ALLOWED_HOST_RE = /(^|\.)(github\.com|githubusercontent\.com|raw\.githubusercontent\.com|openagents-nu\.vercel\.app)$/i;
// A short, adjustable allowlist of common documentation hosts a legitimate
// package might link to or curl from (e.g. to fetch a docs page for a research
// workflow). Extend here rather than loosening ALLOWED_HOST_RE.
const DOCS_HOST_RE = /(^|\.)(readthedocs\.io|developer\.mozilla\.org|docs\.python\.org|nodejs\.org)$/i;
const RAW_IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function scanExfilNetwork(path: string, line: string, lineNo: number, flags: ScanFlag[]) {
  if (!NETWORK_CALL_RE.test(line)) return;

  for (const match of line.matchAll(URL_RE)) {
    let host: string;
    try {
      host = new URL(match[0]).hostname;
    } catch {
      continue;
    }

    if (RAW_IPV4_RE.test(host)) {
      flags.push({
        id: "exfil.network",
        severity: "high",
        path,
        line: lineNo,
        excerpt: excerptOf(line),
        message: `network call to a raw IP address (${host})`,
      });
      continue;
    }

    if (ALLOWED_HOST_RE.test(host) || DOCS_HOST_RE.test(host)) continue;

    flags.push({
      id: "exfil.network",
      severity: "warn",
      path,
      line: lineNo,
      excerpt: excerptOf(line),
      message: `network call to a host outside the allowlist (${host})`,
    });
  }
}

// ---------------------------------------------------------------------------
// destructive
// ---------------------------------------------------------------------------

// "/" or "~" as the *whole* target, not a subpath like "/tmp/build" — a
// package legitimately cleaning its own build output is not this rule's target.
const RM_RF_ROOT_RE = /\brm\s+(?:-\w*r\w*f\w*|-\w*f\w*r\w*)\s+\/(?:\s|["'`]|$)/;
const RM_RF_HOME_RE = /\brm\s+(?:-\w*r\w*f\w*|-\w*f\w*r\w*)\s+~(?:\s|["'`]|$)/;
const GIT_PUSH_RE = /\bgit\s+push\b/i;
const FORCE_FLAG_RE = /(--force\b|--force-with-lease\b|(?:^|\s)-f\b)/;
const MAIN_MASTER_RE = /\b(main|master)\b/;
const DROP_DATABASE_RE = /\bDROP\s+DATABASE\b/i;
const FORMAT_C_RE = /\bformat\s+c:/i;
const MKFS_RE = /\bmkfs(?:\.\w+)?\b/i;
const FORK_BOMB_RE = /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;

function scanDestructive(path: string, line: string, lineNo: number, flags: ScanFlag[]) {
  const push = (message: string) =>
    flags.push({ id: "destructive", severity: "high", path, line: lineNo, excerpt: excerptOf(line), message });

  if (RM_RF_ROOT_RE.test(line)) push("`rm -rf /` — recursively deletes the entire filesystem");
  if (RM_RF_HOME_RE.test(line)) push("`rm -rf ~` — recursively deletes the user's home directory");
  if (GIT_PUSH_RE.test(line) && FORCE_FLAG_RE.test(line) && MAIN_MASTER_RE.test(line)) {
    push("force-push to main/master — rewrites shared history");
  }
  if (DROP_DATABASE_RE.test(line)) push("`DROP DATABASE` — destroys an entire database");
  if (FORMAT_C_RE.test(line)) push("`format c:` — reformats the system drive");
  if (MKFS_RE.test(line)) push("`mkfs` — reformats a filesystem/block device");
  if (FORK_BOMB_RE.test(line)) push("fork bomb — exhausts system resources");
}

// ---------------------------------------------------------------------------
// secrets
// ---------------------------------------------------------------------------

const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/;
const GITHUB_TOKEN_RE = /gh[pousr]_[A-Za-z0-9]{36}/;
const SK_KEY_RE = /sk-[A-Za-z0-9]{20,}/;
const PRIVATE_KEY_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/;

function scanSecrets(path: string, line: string, lineNo: number, flags: ScanFlag[]) {
  const push = (message: string) =>
    flags.push({ id: "secrets", severity: "high", path, line: lineNo, excerpt: excerptOf(line), message });

  if (AWS_KEY_RE.test(line)) push("looks like an AWS access key id");
  if (GITHUB_TOKEN_RE.test(line)) push("looks like a GitHub personal access/app token");
  if (SK_KEY_RE.test(line)) push(`looks like an API secret key ("sk-...")`);
  if (PRIVATE_KEY_RE.test(line)) push("contains a private key block");
}

// ---------------------------------------------------------------------------
// obfuscation
// ---------------------------------------------------------------------------

const EVAL_RE = /\beval\s*\(/i;
const PYTHON_EXEC_RE = /\bpython3?\s+-c\s+["']/i;
const EXEC_RE = /\bexec\s*\(/i;
const BASE64_MENTION_RE = /base64/i;

function scanObfuscation(path: string, line: string, lineNo: number, flags: ScanFlag[]) {
  if (EVAL_RE.test(line) && BASE64_MENTION_RE.test(line)) {
    flags.push({
      id: "obfuscation",
      severity: "high",
      path,
      line: lineNo,
      excerpt: excerptOf(line),
      message: "eval() of base64-decoded content — hides what actually runs",
    });
  }
  if (PYTHON_EXEC_RE.test(line) && EXEC_RE.test(line) && BASE64_MENTION_RE.test(line)) {
    flags.push({
      id: "obfuscation",
      severity: "high",
      path,
      line: lineNo,
      excerpt: excerptOf(line),
      message: "python -c \"exec(...)\" unpacking base64 — hides what actually runs",
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Caps each rule id's contribution to `score` at two instances — see the
 *  module doc comment's "Scoring" section. `flags` itself is never truncated. */
function computeScore(flags: ScanFlag[]): number {
  const byRule = new Map<string, ScanFlag[]>();
  for (const flag of flags) {
    const list = byRule.get(flag.id);
    if (list) list.push(flag);
    else byRule.set(flag.id, [flag]);
  }

  let score = 0;
  for (const ruleFlags of byRule.values()) {
    // Count the worst offenses first, so a rule mixing severities is scored
    // by its two most serious instances rather than an arbitrary two.
    const weights = ruleFlags
      .map((f) => SEVERITY_WEIGHT[f.severity])
      .sort((a, b) => b - a)
      .slice(0, 2);
    score += weights.reduce((sum, w) => sum + w, 0);
  }
  return Math.min(100, score);
}

/**
 * Scans a set of package files for content-safety issues (see the module doc
 * comment for the rule catalog). Pure and synchronous — no I/O, no network.
 * Binary files (`encoding: "base64"`) are skipped entirely.
 */
export function scanPackage(files: ScanInputFile[]): ScanResult {
  const flags: ScanFlag[] = [];

  for (const file of files) {
    if (file.encoding === "base64") continue; // binary — nothing to scan

    scanInjectionHiddenWhole(file.path, file.content, flags);

    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNo = i + 1;
      scanInjectionOverride(file.path, line, lineNo, flags);
      scanInjectionHiddenLine(file.path, line, lineNo, flags);
      scanExfilEnv(file.path, lines, i, flags);
      scanExfilNetwork(file.path, line, lineNo, flags);
      scanDestructive(file.path, line, lineNo, flags);
      scanSecrets(file.path, line, lineNo, flags);
      scanObfuscation(file.path, line, lineNo, flags);
    }
  }

  return { score: computeScore(flags), flags };
}
