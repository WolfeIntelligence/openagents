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
