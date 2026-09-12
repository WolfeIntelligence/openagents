import { test } from "node:test";
import assert from "node:assert/strict";
import { lintReadme, type LintFinding } from "../readme-lint";
import type { Manifest } from "../types";

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schema: 1,
    name: "pr-reviewer",
    owner: "acme",
    version: "1.0.0",
    kind: "workflow",
    title: "PR Reviewer",
    summary: "Reviews pull requests for style and correctness issues.",
    license: "MIT",
    tags: ["code-review", "github"],
    runtimes: ["claude-code"],
    pricing: { model: "free", amountCents: 0, currency: "usd" },
    entry: "WORKFLOW.md",
    files: ["WORKFLOW.md"],
    inputs: [],
    requires: [],
    homepage: "https://example.com",
    ...overrides,
  };
}

function ids(findings: LintFinding[]): string[] {
  return findings.map((f) => f.id);
}

const GOOD_README = `# PR Reviewer

## Install

Run \`openagents install acme/pr-reviewer\`.

## Usage

\`\`\`
openagents run acme/pr-reviewer --repo owner/name
\`\`\`

This package reviews pull requests for style and correctness issues, posting
inline comments and a summary. It reads the diff, checks it against a
configurable rule set, and leaves feedback directly on GitHub.

## Limitations

Doesn't run on private forks without a token with repo scope.
`.repeat(1);

test("lintReadme: a complete README with a matching manifest produces no findings", () => {
  const findings = lintReadme(GOOD_README, makeManifest(), ["WORKFLOW.md"]);
  assert.deepEqual(findings, []);
});

test("lintReadme: missing-title when there's no top-level heading", () => {
  const readme = "Just some text, no heading.\n\n## Install\n\nRun it.\n";
  const findings = lintReadme(readme);
  assert.ok(ids(findings).includes("missing-title"));
});

test("lintReadme: a heading inside a fenced code block doesn't count as a title", () => {
  const readme = "```\n# Not a real heading\n```\n\nSome body text that is long enough to pass the length check easily, well past three hundred characters of filler content describing this package in exhaustive, repetitive detail so the readme-too-short check does not also fire here and muddy this specific assertion about titles.\n";
  const findings = lintReadme(readme);
  assert.ok(ids(findings).includes("missing-title"));
});

test("lintReadme: missing-usage-section when no install/usage/how-to heading exists", () => {
  const readme = "# My Package\n\n## Overview\n\nDoes things.\n";
  const findings = lintReadme(readme);
  assert.ok(ids(findings).includes("missing-usage-section"));
});

test("lintReadme: a 'How to run it' heading satisfies the usage-section check", () => {
  const readme = "# My Package\n\n## How to run it\n\nDo the thing.\n";
  const findings = lintReadme(readme);
  assert.ok(!ids(findings).includes("missing-usage-section"));
});

test("lintReadme: missing-example when there's no fenced code block", () => {
  const readme = "# My Package\n\n## Usage\n\nJust run it, no example needed.\n";
  const findings = lintReadme(readme);
  assert.ok(ids(findings).includes("missing-example"));
});

test("lintReadme: a fenced code block satisfies the example check", () => {
  const readme = "# My Package\n\n## Usage\n\n```\nopenagents run acme/x\n```\n";
  const findings = lintReadme(readme);
  assert.ok(!ids(findings).includes("missing-example"));
});

test("lintReadme: missing-limitations (warn) when there's no Limitations/Caveats heading", () => {
  const readme = "# My Package\n\n## Usage\n\n```\nrun it\n```\n";
  const findings = lintReadme(readme);
  const finding = findings.find((f) => f.id === "missing-limitations");
  assert.ok(finding);
  assert.equal(finding?.level, "warn");
});

test("lintReadme: summary-length (info) when the README barely exceeds the manifest summary", () => {
  const manifest = makeManifest({ summary: "A short summary of what this does." });
  const readme = "# X\n\nA short summary of what this does.\n";
  const findings = lintReadme(readme, manifest, []);
  const finding = findings.find((f) => f.id === "summary-length");
  assert.ok(finding);
  assert.equal(finding?.level, "info");
});

test("lintReadme: broken-link (error) for a relative link not in the file list", () => {
  const readme = "# X\n\nSee [the config](./config/example.yaml) for details.\n";
  const findings = lintReadme(readme, undefined, ["README.md"]);
  const finding = findings.find((f) => f.id === "broken-link");
  assert.ok(finding);
  assert.equal(finding?.level, "error");
  assert.equal(finding?.path, "config/example.yaml");
});

test("lintReadme: a relative link that IS in the file list is not flagged", () => {
  const readme = "# X\n\nSee [the config](./config/example.yaml) for details.\n";
  const findings = lintReadme(readme, undefined, ["README.md", "config/example.yaml"]);
  assert.ok(!ids(findings).includes("broken-link"));
});

test("lintReadme: absolute links and anchors are never flagged as broken", () => {
  const readme = "# X\n\n[External](https://example.com) and [anchor](#usage).\n";
  const findings = lintReadme(readme, undefined, []);
  assert.ok(!ids(findings).includes("broken-link"));
});

test("lintReadme: todo-placeholder (error) for a leftover TODO: from openagents init", () => {
  const readme = "# X\n\nTODO: describe what this does.\n";
  const findings = lintReadme(readme);
  const finding = findings.find((f) => f.id === "todo-placeholder");
  assert.ok(finding);
  assert.equal(finding?.level, "error");
});

test("lintReadme: readme-too-short (warn) under 300 characters", () => {
  const readme = "# X\n\nShort.\n";
  const findings = lintReadme(readme);
  const finding = findings.find((f) => f.id === "readme-too-short");
  assert.ok(finding);
  assert.equal(finding?.level, "warn");
});

test("lintReadme: no-runtimes (warn) when the manifest lists zero runtimes", () => {
  const manifest = makeManifest({ runtimes: [] });
  const findings = lintReadme(GOOD_README, manifest, []);
  const finding = findings.find((f) => f.id === "no-runtimes");
  assert.ok(finding);
  assert.equal(finding?.level, "warn");
});

test("lintReadme: few-tags (info) when the manifest has fewer than 2 tags", () => {
  const manifest = makeManifest({ tags: ["only-one"] });
  const findings = lintReadme(GOOD_README, manifest, []);
  const finding = findings.find((f) => f.id === "few-tags");
  assert.ok(finding);
  assert.equal(finding?.level, "info");
});

test("lintReadme: missing-links (info) when neither homepage nor repository is set", () => {
  const manifest = makeManifest({ homepage: undefined, repository: undefined });
  const findings = lintReadme(GOOD_README, manifest, []);
  const finding = findings.find((f) => f.id === "missing-links");
  assert.ok(finding);
  assert.equal(finding?.level, "info");
});

test("lintReadme: missing-links is not flagged when only repository is set", () => {
  const manifest = makeManifest({ homepage: undefined, repository: "https://github.com/acme/x" });
  const findings = lintReadme(GOOD_README, manifest, []);
  assert.ok(!ids(findings).includes("missing-links"));
});

test("lintReadme: runs fine with no manifest at all (manifest-dependent checks skipped)", () => {
  const findings = lintReadme(GOOD_README);
  assert.ok(!ids(findings).includes("no-runtimes"));
  assert.ok(!ids(findings).includes("few-tags"));
  assert.ok(!ids(findings).includes("missing-links"));
  assert.ok(!ids(findings).includes("summary-length"));
});
