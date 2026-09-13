// Run via `npm test` (node --import tsx --test) or `npx tsx --test <this file>`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_RE, MAX_CAPABILITIES, MAX_EVIDENCE, parseManifest, safeParseManifest } from "../manifest";

function yaml(...extraLines: string[]): string {
  return [
    "schema: 1",
    "name: pr-reviewer",
    "owner: openagents",
    "version: 1.0.0",
    "kind: workflow",
    "title: PR Reviewer",
    "summary: Reviews pull requests",
    "license: MIT",
    "tags: [code-review]",
    "runtimes: [claude-code]",
    "pricing:",
    "  model: free",
    "  amount_cents: 0",
    "  currency: usd",
    "entry: WORKFLOW.md",
    "files: [WORKFLOW.md]",
    ...extraLines,
    "",
  ].join("\n");
}

describe("CAPABILITY_RE", () => {
  test("accepts a single lowercase word", () => {
    assert.match("summarize", CAPABILITY_RE);
  });

  test("accepts space- and hyphen-separated verb phrases", () => {
    assert.match("reconcile csv", CAPABILITY_RE);
    assert.match("review-pull-request", CAPABILITY_RE);
  });

  test("accepts digits within/after a word", () => {
    assert.match("summarize q3 report", CAPABILITY_RE);
  });

  test("rejects uppercase", () => {
    assert.doesNotMatch("Reconcile csv", CAPABILITY_RE);
  });

  test("rejects a leading digit or separator", () => {
    assert.doesNotMatch("3d modeling", CAPABILITY_RE);
    assert.doesNotMatch(" reconcile", CAPABILITY_RE);
    assert.doesNotMatch("-reconcile", CAPABILITY_RE);
  });

  test("rejects a trailing separator", () => {
    assert.doesNotMatch("reconcile ", CAPABILITY_RE);
    assert.doesNotMatch("reconcile-", CAPABILITY_RE);
  });

  test("rejects a doubled separator", () => {
    assert.doesNotMatch("reconcile  csv", CAPABILITY_RE);
    assert.doesNotMatch("reconcile--csv", CAPABILITY_RE);
  });

  test("rejects punctuation other than space/hyphen", () => {
    assert.doesNotMatch("reconcile_csv", CAPABILITY_RE);
    assert.doesNotMatch("reconcile.csv", CAPABILITY_RE);
  });
});

describe("parseManifest — capabilities", () => {
  test("defaults to an empty array when absent", () => {
    const manifest = parseManifest(yaml());
    assert.deepEqual(manifest.capabilities, []);
  });

  test("parses a valid capabilities list", () => {
    const manifest = parseManifest(yaml("capabilities: [reconcile csv, review pull request]"));
    assert.deepEqual(manifest.capabilities, ["reconcile csv", "review pull request"]);
  });

  test("rejects a malformed entry", () => {
    const result = safeParseManifest(yaml("capabilities: [Reconcile CSV]"));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes("capabilities")));
    }
  });

  test("rejects more than the max number of entries", () => {
    const many = Array.from({ length: MAX_CAPABILITIES + 1 }, (_, i) => `capability ${i}`);
    const result = safeParseManifest(yaml(`capabilities: [${many.join(", ")}]`));
    assert.equal(result.ok, false);
  });

  test("rejects an entry over the max length", () => {
    const result = safeParseManifest(yaml(`capabilities: ["${"a".repeat(61)}"]`));
    assert.equal(result.ok, false);
  });

  test("accepts exactly the max number of entries", () => {
    const many = Array.from({ length: MAX_CAPABILITIES }, (_, i) => `capability ${i}`);
    const result = safeParseManifest(yaml(`capabilities: [${many.join(", ")}]`));
    assert.equal(result.ok, true);
  });
});

describe("parseManifest — provenance (origin/evidence/attested_by)", () => {
  test("all three are absent by default", () => {
    const manifest = parseManifest(yaml());
    assert.equal(manifest.origin, undefined);
    assert.equal(manifest.evidence, undefined);
    assert.equal(manifest.attestedBy, undefined);
  });

  test("parses a valid origin", () => {
    const manifest = parseManifest(
      yaml("origin:", "  repo: github.com/some-org/some-skill", "  commit: 4b825dc642cb6eb9a060e54bf8d69288fbee4904")
    );
    assert.deepEqual(manifest.origin, {
      repo: "github.com/some-org/some-skill",
      commit: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    });
  });

  test("rejects a non-hex or too-short commit", () => {
    for (const commit of ["not-hex-zzzz", "abc123", "4B825DC642CB6EB9A060E54BF8D69288FBEE4904"]) {
      const result = safeParseManifest(yaml("origin:", "  repo: some/repo", `  commit: ${commit}`));
      assert.equal(result.ok, false, `expected ${commit} to be rejected`);
    }
  });

  test("accepts a short (7-char) commit sha", () => {
    const result = safeParseManifest(yaml("origin:", "  repo: some/repo", "  commit: 4b825dc"));
    assert.equal(result.ok, true);
  });

  test("parses evidence entries, note optional", () => {
    const manifest = parseManifest(
      yaml(
        "evidence:",
        "  - url: https://example.com/repo",
        "    kind: repo",
        "    note: Original source",
        "  - url: https://example.com/bench",
        "    kind: benchmark"
      )
    );
    assert.equal(manifest.evidence?.length, 2);
    assert.deepEqual(manifest.evidence?.[0], {
      url: "https://example.com/repo",
      kind: "repo",
      note: "Original source",
    });
    assert.equal(manifest.evidence?.[1].url, "https://example.com/bench");
    assert.equal(manifest.evidence?.[1].kind, "benchmark");
    assert.equal(manifest.evidence?.[1].note, undefined);
  });

  test("rejects an evidence entry with an invalid url", () => {
    const result = safeParseManifest(yaml("evidence:", "  - url: not-a-url", "    kind: repo"));
    assert.equal(result.ok, false);
  });

  test("rejects more than the max number of evidence entries", () => {
    const lines = ["evidence:"];
    for (let i = 0; i < MAX_EVIDENCE + 1; i++) {
      lines.push(`  - url: https://example.com/${i}`, "    kind: repo");
    }
    const result = safeParseManifest(yaml(...lines));
    assert.equal(result.ok, false);
  });

  test("parses attested_by, mapping run_id to runId", () => {
    const manifest = parseManifest(yaml("attested_by:", "  name: scout", "  run_id: run_2026-09-13_0147"));
    assert.deepEqual(manifest.attestedBy, { name: "scout", runId: "run_2026-09-13_0147" });
  });

  test("attested_by.run_id is optional", () => {
    const manifest = parseManifest(yaml("attested_by:", "  name: scout"));
    assert.deepEqual(manifest.attestedBy, { name: "scout", runId: undefined });
  });

  test("rejects attested_by with no name", () => {
    const result = safeParseManifest(yaml("attested_by:", "  run_id: run_1"));
    assert.equal(result.ok, false);
  });
});
