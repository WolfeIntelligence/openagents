// Zod schema + parse/validate helpers for `openagent.yaml`.
//
// The on-disk YAML uses snake_case keys (per SPEC.md); this module maps them
// onto the camelCase `Manifest` type from `src/lib/types.ts` (authoritative —
// do not redefine fields here, only shape the parser around them).

import { z } from "zod";
import { parse as parseYamlDocument } from "yaml";
import {
  PACKAGE_KINDS,
  RUNTIME_IDS,
  PRICING_MODELS,
  type Manifest,
} from "@/lib/types";

/** `owner` and `name` share this shape per SPEC.md. */
export const NAME_RE = /^[a-z0-9-]{2,64}$/;

/** Simple (non-exhaustive) semver matcher: MAJOR.MINOR.PATCH with optional -prerelease/+build. */
export const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const DEFAULT_PRICING = { model: "free" as const, amount_cents: 0, currency: "usd" };

const rawPricingSchema = z
  .object({
    model: z.enum(PRICING_MODELS).default("free"),
    amount_cents: z.number().int().min(0).default(0),
    currency: z.string().min(1).default("usd"),
  })
  .default(DEFAULT_PRICING)
  .refine((p) => p.model === "free" || p.amount_cents > 0, {
    message: 'paid packages (pricing.model != "free") must have amount_cents > 0',
    path: ["amount_cents"],
  });

const rawInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "path", "url"]),
  required: z.boolean(),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const rawManifestSchema = z.object({
  schema: z.literal(1),
  name: z.string().regex(NAME_RE, "must match ^[a-z0-9-]{2,64}$"),
  owner: z.string().regex(NAME_RE, "must match ^[a-z0-9-]{2,64}$"),
  version: z.string().regex(SEMVER_RE, "must be semver, e.g. 1.2.0"),
  kind: z.enum(PACKAGE_KINDS),
  title: z.string().min(1),
  summary: z.string().min(1).max(160, "must be <= 160 chars"),
  license: z.string().min(1),
  tags: z.array(z.string()).default([]),
  runtimes: z.array(z.enum(RUNTIME_IDS)).default([]),
  pricing: rawPricingSchema,
  entry: z.string().min(1),
  files: z.array(z.string()).default([]),
  inputs: z.array(rawInputSchema).default([]),
  requires: z.array(z.string()).default([]),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
});

/**
 * Public schema: parses raw (snake_case) `openagent.yaml` JS objects and
 * transforms them into the authoritative camelCase `Manifest` shape.
 */
export const manifestSchema = rawManifestSchema.transform(
  (m): Manifest => ({
    schema: 1,
    name: m.name,
    owner: m.owner,
    version: m.version,
    kind: m.kind,
    title: m.title,
    summary: m.summary,
    license: m.license,
    tags: m.tags,
    runtimes: m.runtimes,
    pricing: {
      model: m.pricing.model,
      amountCents: m.pricing.amount_cents,
      currency: m.pricing.currency,
    },
    entry: m.entry,
    files: m.files,
    inputs: m.inputs.map((i) => ({
      name: i.name,
      type: i.type,
      required: i.required,
      description: i.description,
      default: i.default,
    })),
    requires: m.requires,
    homepage: m.homepage,
    repository: m.repository,
  })
);

export class ManifestError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(
      issues.length === 1
        ? `Invalid openagent.yaml: ${issues[0]}`
        : `Invalid openagent.yaml:\n${issues.map((i) => `  - ${i}`).join("\n")}`
    );
    this.name = "ManifestError";
    this.issues = issues;
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function parseYamlSafely(yamlText: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value = parseYamlDocument(yamlText);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: `YAML syntax error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Parses and validates `openagent.yaml` text. Throws `ManifestError` with a readable, multi-issue message. */
export function parseManifest(yamlText: string): Manifest {
  const parsed = parseYamlSafely(yamlText);
  if (!parsed.ok) {
    throw new ManifestError([parsed.error]);
  }
  const result = manifestSchema.safeParse(parsed.value);
  if (!result.success) {
    throw new ManifestError(formatIssues(result.error));
  }
  return result.data;
}

/** Same as `parseManifest` but never throws. */
export function safeParseManifest(
  yamlText: string
): { ok: true; manifest: Manifest } | { ok: false; errors: string[] } {
  const parsed = parseYamlSafely(yamlText);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error] };
  }
  const result = manifestSchema.safeParse(parsed.value);
  if (!result.success) {
    return { ok: false, errors: formatIssues(result.error) };
  }
  return { ok: true, manifest: result.data };
}

/**
 * Cross-checks a parsed manifest's `entry` and `files` against the paths that
 * actually exist for the package. Returns a (possibly empty) list of error
 * strings; does not throw.
 */
export function validateManifestFiles(manifest: Manifest, availablePaths: string[]): string[] {
  const errors: string[] = [];
  const available = new Set(availablePaths);
  if (!available.has(manifest.entry)) {
    errors.push(`entry file not found: ${manifest.entry}`);
  }
  for (const file of manifest.files) {
    if (!available.has(file)) {
      errors.push(`file not found: ${file}`);
    }
  }
  return errors;
}
