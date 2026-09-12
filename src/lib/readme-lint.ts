// README lint (Z4): pure heuristic checks over a package's README.md, run by
// `POST /api/v1/validate` before publish so a seller sees quality issues in the
// wizard instead of discovering them after the fact on the package page.
//
// Every check here is non-blocking (unlike the manifest/file-existence errors
// `validateManifestFiles` produces) — the worst a lint finding gets is "error"
// level for something that's unambiguously broken (a dead relative link, a
// leftover `TODO:` placeholder), never a reason to refuse a publish outright.
// No DB, no env — pure string/regex analysis over `readme` (and, optionally,
// `manifest`/`availablePaths` for the checks that need them), so it's safe to
// call from the zero-auth `/api/v1/validate` route and unit-test directly.

import type { Manifest } from "@/lib/types";

export type LintLevel = "error" | "warn" | "info";

export interface LintFinding {
  /** Stable machine-readable id, e.g. "missing-title" — lets the wizard attach
   *  a fix suggestion per finding without string-matching `message`. */
  id: string;
  level: LintLevel;
  message: string;
  /** Set for findings about a specific file (currently only broken links). */
  path?: string;
}

const README_MIN_CHARS = 300;
const MIN_TAGS = 2;

const HEADING_RE = /^#{1,6}\s+(.+)\s*$/gm;
const FENCE_RE = /^(```|~~~)/gm;
// Matches both `[text](url)` and `![alt](url)`, capturing the url and
// ignoring an optional `"title"` suffix.
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const TODO_RE = /\bTODO:/;

/** Strips fenced code blocks (```...``` or ~~~...~~~) before heading/text
 *  analysis, so a `#` or "install" inside an example never counts. */
function stripCodeFences(readme: string): string {
  const lines = readme.split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join("\n");
}

function headings(readme: string): string[] {
  const stripped = stripCodeFences(readme);
  return [...stripped.matchAll(HEADING_RE)].map((m) => m[1].trim().toLowerCase());
}

function hasHeadingMatching(readme: string, keywords: string[]): boolean {
  const hs = headings(readme);
  return hs.some((h) => keywords.some((k) => h.includes(k)));
}

/** True when the README has at least one fenced code block outside its own
 *  headings — the cheapest reasonable proxy for "includes an example". */
function hasExample(readme: string): boolean {
  const fences = readme.match(FENCE_RE);
  return Boolean(fences && fences.length >= 2);
}

/** True for absolute URLs (has a scheme, e.g. `https:`) or protocol-relative `//`. */
function isAbsoluteUrl(url: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

/** Relative links the README points at that don't exist in the upload —
 *  normalizes a leading `./`/`/` the same way `Markdown.tsx` does, and
 *  refuses (skips) anything trying to climb out with `..` rather than
 *  guessing at what it might mean. */
function findBrokenLinks(readme: string, availablePaths: string[]): string[] {
  const available = new Set(availablePaths);
  const broken: string[] = [];
  for (const match of stripCodeFences(readme).matchAll(LINK_RE)) {
    const url = match[1];
    if (!url || url.startsWith("#") || url.startsWith("mailto:")) continue;
    if (isAbsoluteUrl(url)) continue;
    if (url.includes("..")) continue;
    const normalized = url.replace(/^\.?\/+/, "").split("#")[0].split("?")[0];
    if (normalized && !available.has(normalized)) broken.push(normalized);
  }
  return [...new Set(broken)];
}

/**
 * Lints a README against the checks documented in AGENTS.md's Z4 contract.
 * `manifest`/`availablePaths` are optional so this can still run (with the
 * manifest-dependent checks skipped) when the manifest itself failed to
 * parse — a broken manifest shouldn't hide otherwise-useful README feedback.
 */
export function lintReadme(
  readme: string,
  manifest?: Manifest,
  availablePaths: string[] = []
): LintFinding[] {
  const findings: LintFinding[] = [];
  const trimmed = readme.trim();

  if (!/^#\s+\S/m.test(stripCodeFences(readme))) {
    findings.push({
      id: "missing-title",
      level: "warn",
      message: "No top-level heading (# Title) found — READMEs read better with one up top.",
    });
  }

  if (!hasHeadingMatching(readme, ["install", "usage", "how to"])) {
    findings.push({
      id: "missing-usage-section",
      level: "warn",
      message: 'No "Install", "Usage", or "How to" section found — add one so buyers know how to run this.',
    });
  }

  if (!hasExample(readme)) {
    findings.push({
      id: "missing-example",
      level: "warn",
      message: "No code example (fenced code block) found — an example is the fastest way to show what this does.",
    });
  }

  if (!hasHeadingMatching(readme, ["limitation", "caveat"])) {
    findings.push({
      id: "missing-limitations",
      level: "warn",
      message: 'No "Limitations" or "Caveats" section — buyers trust packages more when they know the edges.',
    });
  }

  if (manifest) {
    const summaryLen = manifest.summary.trim().length;
    // The README should say more than the one-line manifest summary already
    // does — if it's about the same length (or shorter), it isn't adding
    // anything a buyer couldn't already see on the listing card.
    if (trimmed.length > 0 && trimmed.length <= summaryLen * 1.5) {
      findings.push({
        id: "summary-length",
        level: "info",
        message: "README is barely longer than the manifest summary — consider expanding on what it does and why.",
      });
    }
  }

  for (const path of findBrokenLinks(readme, availablePaths)) {
    findings.push({
      id: "broken-link",
      level: "error",
      message: `README links to "${path}", which isn't in this upload.`,
      path,
    });
  }

  if (TODO_RE.test(readme)) {
    findings.push({
      id: "todo-placeholder",
      level: "error",
      message: 'Leftover "TODO:" placeholder from `openagents init` — fill it in before publishing.',
    });
  }

  if (trimmed.length < README_MIN_CHARS) {
    findings.push({
      id: "readme-too-short",
      level: "warn",
      message: `README is ${trimmed.length} characters — under ${README_MIN_CHARS} is usually too thin to be useful.`,
    });
  }

  if (manifest && manifest.runtimes.length === 0) {
    findings.push({
      id: "no-runtimes",
      level: "warn",
      message: "No runtimes listed in openagent.yaml — buyers filter by runtime, so this package won't show up.",
    });
  }

  if (manifest && manifest.tags.length < MIN_TAGS) {
    findings.push({
      id: "few-tags",
      level: "info",
      message: `Only ${manifest.tags.length} tag(s) — at least ${MIN_TAGS} helps this surface in search and browse.`,
    });
  }

  if (manifest && !manifest.homepage && !manifest.repository) {
    findings.push({
      id: "missing-links",
      level: "info",
      message: "No homepage or repository set in openagent.yaml — linking one builds buyer trust.",
    });
  }

  return findings;
}
