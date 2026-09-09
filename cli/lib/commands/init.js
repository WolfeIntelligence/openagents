import fs from "node:fs";
import path from "node:path";
import { NAME_RE, PACKAGE_KINDS, RUNTIME_IDS } from "../manifest.js";

const ENTRY_BY_KIND = {
  workflow: "WORKFLOW.md",
  harness: "HARNESS.md",
  rules: "RULES.md",
  skill: "SKILL.md",
};

function titleCase(name) {
  return name
    .split("-")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function sanitizeName(raw) {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length >= 2 ? slug.slice(0, 64) : "my-package";
}

function yamlManifestText({ name, owner, version, kind, title, summary, license, tags, runtimes, entry }) {
  const tagsLine = tags.length ? `[${tags.join(", ")}]` : "[]";
  const runtimesLine = `[${runtimes.join(", ")}]`;
  return `schema: 1
name: ${name}
owner: ${owner}
version: ${version}
kind: ${kind}
title: ${title}
summary: ${summary}
license: ${license}
tags: ${tagsLine}
runtimes: ${runtimesLine}
pricing:
  model: free
  amount_cents: 0
  currency: usd
entry: ${entry}
files:
  - ${entry}
inputs: []
requires: []
`;
}

function entryTemplate(kind, title) {
  const headingByKind = {
    workflow: "Workflow",
    harness: "Harness",
    rules: "Rules",
    skill: "Skill",
  };
  return `# ${title} — ${headingByKind[kind]}

TODO: describe what this ${kind} does in 2-4 sentences.

## Steps

1. TODO: first step.
2. TODO: next step.
3. TODO: ...

## Stop conditions

- TODO: when to stop / ask for confirmation rather than guessing.
`;
}

function readmeTemplate({ title, summary, name, kind }) {
  return `# ${title}

${summary}

## When to use

TODO: describe the situations this ${kind} is a good fit for.

## Install

\`\`\`bash
npx openagents add <owner>/${name}
\`\`\`

## Inputs

TODO: document any inputs declared in openagent.yaml, or remove this section if none.

## Example run

TODO: a short example of invoking this package.

## Limitations

TODO: known limitations.
`;
}

export function run(args) {
  const dir = path.resolve(args.dir || ".");
  const kind = args.kind || "workflow";
  if (!PACKAGE_KINDS.includes(kind)) {
    console.error(`✗ --kind must be one of ${PACKAGE_KINDS.join(", ")}, got: ${kind}`);
    process.exitCode = 1;
    return;
  }

  const rawName = args.name || path.basename(dir);
  const name = NAME_RE.test(rawName) ? rawName : sanitizeName(rawName);
  const owner = args.owner || "me";
  const version = args.version || "1.0.0";
  const title = args.title || titleCase(name);
  const summary = (args.summary || `TODO: one-line description of ${title} (<= 160 chars).`).slice(0, 160);
  const license = args.license || "MIT";
  const tags = args.tags ? args.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const runtimes = args.runtimes
    ? args.runtimes.split(",").map((r) => r.trim()).filter(Boolean)
    : ["claude-code", "generic"];
  for (const r of runtimes) {
    if (!RUNTIME_IDS.includes(r)) {
      console.error(`✗ unknown runtime "${r}", must be one of ${RUNTIME_IDS.join(", ")}`);
      process.exitCode = 1;
      return;
    }
  }
  const entry = ENTRY_BY_KIND[kind];

  fs.mkdirSync(dir, { recursive: true });

  const manifestPath = path.join(dir, "openagent.yaml");
  const readmePath = path.join(dir, "README.md");
  const entryPath = path.join(dir, entry);

  const writes = [
    [manifestPath, yamlManifestText({ name, owner, version, kind, title, summary, license, tags, runtimes, entry })],
    [readmePath, readmeTemplate({ title, summary, name, kind })],
    [entryPath, entryTemplate(kind, title)],
  ];

  for (const [p] of writes) {
    if (fs.existsSync(p) && !args.force) {
      console.error(`✗ ${path.relative(process.cwd(), p)} already exists (use --force to overwrite)`);
      process.exitCode = 1;
      return;
    }
  }

  for (const [p, content] of writes) {
    fs.writeFileSync(p, content, "utf8");
    console.log(`  created ${path.relative(process.cwd(), p)}`);
  }

  console.log(`\n✓ scaffolded ${owner}/${name} (${kind}) in ${path.relative(process.cwd(), dir) || "."}`);
  console.log(`  next: fill in ${entry} and README.md, then run "openagents validate ${path.relative(process.cwd(), dir) || "."}"`);
}
