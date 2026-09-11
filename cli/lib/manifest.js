// Hand-written validation for `openagent.yaml` (no zod, per SPEC — the CLI
// ships with zero runtime dependencies besides `tar`). Mirrors the schema
// documented in SPEC.md and src/lib/types.ts, but does not import from the
// site's source tree.

import { parseYaml } from "./yaml.js";

export const PACKAGE_KINDS = ["workflow", "harness", "rules", "skill"];
export const RUNTIME_IDS = [
  "claude-code",
  "cursor",
  "codex",
  "openai-agents",
  "langgraph",
  "generic",
];
export const PRICING_MODELS = ["free", "one-time", "subscription"];

export const NAME_RE = /^[a-z0-9-]{2,64}$/;
export const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Parse `openagent.yaml` text into the raw (snake_case) manifest object. */
export function parseManifest(yamlText) {
  return parseYaml(yamlText);
}

/**
 * Validate a raw manifest object. Returns an array of human-readable issue
 * strings (empty array = valid). Does not throw.
 */
export function validateManifest(m) {
  const issues = [];
  const req = (cond, msg) => {
    if (!cond) issues.push(msg);
  };

  if (m === null || typeof m !== "object" || Array.isArray(m)) {
    return ["manifest is not a YAML mapping"];
  }

  req(m.schema === 1, "schema: must be exactly 1");
  req(typeof m.name === "string" && NAME_RE.test(m.name), "name: must match ^[a-z0-9-]{2,64}$");
  req(typeof m.owner === "string" && NAME_RE.test(m.owner), "owner: must match ^[a-z0-9-]{2,64}$");
  req(typeof m.version === "string" && SEMVER_RE.test(m.version), "version: must be semver, e.g. 1.2.0");
  req(typeof m.kind === "string" && PACKAGE_KINDS.includes(m.kind), `kind: must be one of ${PACKAGE_KINDS.join(", ")}`);
  req(typeof m.title === "string" && m.title.length > 0, "title: required, non-empty string");
  req(typeof m.summary === "string" && m.summary.length > 0, "summary: required, non-empty string");
  req(typeof m.summary !== "string" || m.summary.length <= 160, "summary: must be <= 160 chars");
  req(typeof m.license === "string" && m.license.length > 0, "license: required, non-empty string (SPDX id, or \"proprietary\")");
  req(Array.isArray(m.tags), "tags: must be a list");
  req(
    Array.isArray(m.runtimes) && m.runtimes.length > 0 && m.runtimes.every((r) => RUNTIME_IDS.includes(r)),
    `runtimes: must be a non-empty list of ${RUNTIME_IDS.join(", ")}`
  );
  req(typeof m.entry === "string" && m.entry.length > 0, "entry: required, non-empty string");
  req(Array.isArray(m.files) && m.files.length > 0, "files: must be a non-empty list");
  req(!Array.isArray(m.files) || !m.entry || m.files.includes(m.entry), "files: must include the entry file");

  if (m.pricing === null || typeof m.pricing !== "object") {
    issues.push("pricing: required object with model, amount_cents, currency");
  } else {
    req(PRICING_MODELS.includes(m.pricing.model), `pricing.model: must be one of ${PRICING_MODELS.join(", ")}`);
    req(Number.isInteger(m.pricing.amount_cents) && m.pricing.amount_cents >= 0, "pricing.amount_cents: must be a non-negative integer");
    req(typeof m.pricing.currency === "string" && m.pricing.currency.length > 0, "pricing.currency: required, e.g. \"usd\"");
    if (m.pricing.interval !== undefined) {
      req(["month", "year"].includes(m.pricing.interval), 'pricing.interval: must be "month" or "year"');
    }
    if (m.pricing.model && m.pricing.model !== "free" && m.pricing.amount_cents === 0) {
      issues.push('pricing.amount_cents: must be > 0 when pricing.model is not "free"');
    }
  }

  if (m.inputs !== undefined) {
    req(Array.isArray(m.inputs), "inputs: must be a list when present");
    if (Array.isArray(m.inputs)) {
      m.inputs.forEach((inp, i) => {
        if (inp === null || typeof inp !== "object") {
          issues.push(`inputs[${i}]: must be a mapping`);
          return;
        }
        req(typeof inp.name === "string" && inp.name.length > 0, `inputs[${i}].name: required`);
        req(
          ["string", "number", "boolean", "path", "url"].includes(inp.type),
          `inputs[${i}].type: must be one of string, number, boolean, path, url`
        );
        req(typeof inp.required === "boolean", `inputs[${i}].required: must be true/false`);
      });
    }
  }

  if (m.requires !== undefined) {
    req(Array.isArray(m.requires), "requires: must be a list when present");
  }

  return issues;
}

/**
 * Cross-check a manifest's `entry`/`files` against paths that actually exist
 * on disk (relative to the package directory). Returns an issue list.
 */
export function validateManifestFiles(manifest, availablePaths) {
  const issues = [];
  const available = new Set(availablePaths);
  if (manifest.entry && !available.has(manifest.entry)) {
    issues.push(`entry file not found on disk: ${manifest.entry}`);
  }
  if (Array.isArray(manifest.files)) {
    for (const f of manifest.files) {
      if (!available.has(f)) issues.push(`file listed in manifest but not found on disk: ${f}`);
    }
  }
  return issues;
}
