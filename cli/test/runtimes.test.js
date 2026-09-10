import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installDir, detectRuntime, RUNTIME_IDS } from "../lib/runtimes.js";

// Mirrors src/lib/runtimes.ts's RUNTIMES[id].installDir(name) (that side
// includes a trailing slash; stripped below for comparison). The CLI cannot
// import TypeScript from src/, so this is a literal table kept in sync by
// hand — see the "SOURCE OF TRUTH" comment at the top of src/lib/runtimes.ts.
// This test exists so a future edit to either side that breaks the sync is
// caught immediately instead of silently drifting (S11).
const SITE_INSTALL_DIR_TEMPLATES = {
  "claude-code": (name) => `.claude/skills/${name}/`,
  cursor: (name) => `.cursor/rules/${name}/`,
  codex: (name) => `.codex/skills/${name}/`,
  "openai-agents": (name) => `.openai-agents/${name}/`,
  langgraph: (name) => `.langgraph/${name}/`,
  generic: (name) => `.openagents/${name}/`,
};

describe("installDir matches src/lib/runtimes.ts (S11)", () => {
  for (const id of RUNTIME_IDS) {
    test(id, () => {
      const cli = installDir(id, "example-pkg");
      const site = SITE_INSTALL_DIR_TEMPLATES[id]("example-pkg").replace(/\/$/, "");
      assert.equal(cli, site);
    });
  }

  test("RUNTIME_IDS matches the site's runtime id set", () => {
    assert.deepEqual([...RUNTIME_IDS].sort(), Object.keys(SITE_INSTALL_DIR_TEMPLATES).sort());
  });
});

describe("detectRuntime", () => {
  test("detects claude-code first when multiple markers exist", () => {
    const markers = new Set(["/proj/.claude", "/proj/.cursor"]);
    assert.equal(
      detectRuntime("/proj", (p) => markers.has(p)),
      "claude-code"
    );
  });

  test("detects cursor", () => {
    assert.equal(
      detectRuntime("/proj", (p) => p === "/proj/.cursor"),
      "cursor"
    );
  });

  test("falls back to generic when nothing matches", () => {
    assert.equal(
      detectRuntime("/proj", () => false),
      "generic"
    );
  });
});

test("installDir throws on an unknown runtime id", () => {
  assert.throws(() => installDir("nope", "x"), /unknown runtime/);
});
