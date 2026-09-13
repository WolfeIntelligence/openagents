import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateManifest } from "../lib/manifest.js";

function baseManifest(overrides = {}) {
  return {
    schema: 1,
    name: "demo",
    owner: "acme",
    version: "1.0.0",
    kind: "skill",
    title: "Demo",
    summary: "A demo package.",
    license: "MIT",
    tags: [],
    runtimes: ["generic"],
    pricing: { model: "free", amount_cents: 0, currency: "usd" },
    entry: "SKILL.md",
    files: ["SKILL.md"],
    ...overrides,
  };
}

describe("validateManifest — capabilities", () => {
  test("absent capabilities is valid (optional field)", () => {
    assert.deepEqual(validateManifest(baseManifest()), []);
  });

  test("a well-formed capabilities list is valid", () => {
    const issues = validateManifest(baseManifest({ capabilities: ["reconcile csv", "review-pull-request"] }));
    assert.deepEqual(issues, []);
  });

  test("rejects a non-list capabilities value", () => {
    const issues = validateManifest(baseManifest({ capabilities: "reconcile csv" }));
    assert.ok(issues.some((i) => i.includes("capabilities: must be a list")));
  });

  test("rejects an entry with uppercase or bad punctuation", () => {
    const issues = validateManifest(baseManifest({ capabilities: ["Reconcile CSV"] }));
    assert.ok(issues.some((i) => i.startsWith("capabilities[0]")));
  });

  test("rejects a leading/trailing/doubled separator", () => {
    for (const bad of [" reconcile", "reconcile ", "reconcile  csv", "-reconcile", "reconcile-"]) {
      const issues = validateManifest(baseManifest({ capabilities: [bad] }));
      assert.ok(issues.some((i) => i.startsWith("capabilities[0]")), `expected an issue for ${JSON.stringify(bad)}`);
    }
  });

  test("rejects an entry over the max length", () => {
    const issues = validateManifest(baseManifest({ capabilities: ["a".repeat(61)] }));
    assert.ok(issues.some((i) => i.startsWith("capabilities[0]")));
  });

  test("rejects more than 20 entries", () => {
    const capabilities = Array.from({ length: 21 }, (_, i) => `capability ${i}`);
    const issues = validateManifest(baseManifest({ capabilities }));
    assert.ok(issues.some((i) => i.includes("at most 20 entries")));
  });
});

describe("validateManifest — provenance (origin/evidence/attested_by)", () => {
  test("all three are optional", () => {
    assert.deepEqual(validateManifest(baseManifest()), []);
  });

  test("a well-formed origin is valid", () => {
    const issues = validateManifest(
      baseManifest({ origin: { repo: "github.com/acme/demo", commit: "4b825dc642cb6eb9a060e54bf8d69288fbee4904" } })
    );
    assert.deepEqual(issues, []);
  });

  test("rejects a non-hex origin.commit", () => {
    const issues = validateManifest(baseManifest({ origin: { repo: "acme/demo", commit: "not-hex" } }));
    assert.ok(issues.some((i) => i.startsWith("origin.commit")));
  });

  test("rejects origin missing repo", () => {
    const issues = validateManifest(baseManifest({ origin: { commit: "4b825dc" } }));
    assert.ok(issues.some((i) => i.startsWith("origin.repo")));
  });

  test("a well-formed evidence list is valid", () => {
    const issues = validateManifest(
      baseManifest({ evidence: [{ url: "https://example.com/repo", kind: "repo", note: "source" }] })
    );
    assert.deepEqual(issues, []);
  });

  test("rejects an evidence entry with a bad url", () => {
    const issues = validateManifest(baseManifest({ evidence: [{ url: "not-a-url", kind: "repo" }] }));
    assert.ok(issues.some((i) => i.startsWith("evidence[0].url")));
  });

  test("rejects more than 20 evidence entries", () => {
    const evidence = Array.from({ length: 21 }, (_, i) => ({ url: `https://example.com/${i}`, kind: "repo" }));
    const issues = validateManifest(baseManifest({ evidence }));
    assert.ok(issues.some((i) => i.includes("at most 20 entries")));
  });

  test("a well-formed attested_by is valid", () => {
    const issues = validateManifest(baseManifest({ attested_by: { name: "scout", run_id: "run_1" } }));
    assert.deepEqual(issues, []);
  });

  test("attested_by.run_id is optional", () => {
    const issues = validateManifest(baseManifest({ attested_by: { name: "scout" } }));
    assert.deepEqual(issues, []);
  });

  test("rejects attested_by with no name", () => {
    const issues = validateManifest(baseManifest({ attested_by: { run_id: "run_1" } }));
    assert.ok(issues.some((i) => i.startsWith("attested_by.name")));
  });
});
