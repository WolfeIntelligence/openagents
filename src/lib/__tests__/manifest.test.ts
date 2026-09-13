// Run via `npm test` (node --import tsx --test) or `npx tsx --test <this file>`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_RE, MAX_CAPABILITIES, parseManifest, safeParseManifest } from "../manifest";

function yaml(capabilitiesLine?: string): string {
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
    ...(capabilitiesLine ? [capabilitiesLine] : []),
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
