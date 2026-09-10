import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../lib/yaml.js";

// Compares this hand-written parser's output against the real `yaml` package
// (resolved from the repo root's node_modules via the junction set up for
// this worktree) so that B13b's promise — "the CLI parser and the server's
// real YAML parser must agree" — is actually verified, not just asserted.
let realParse = null;
try {
  ({ parse: realParse } = await import("yaml"));
} catch {
  // `yaml` isn't installed in this environment (e.g. CI without the site's
  // node_modules); skip the cross-parser comparisons rather than failing.
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogDir = path.join(__dirname, "..", "..", "catalog", "openagents");

function agree(t, text) {
  if (!realParse) {
    t.skip("real `yaml` package not available in this environment");
    return;
  }
  const real = realParse(text);
  const ours = parseYaml(text);
  assert.deepEqual(ours, real, `parseYaml disagreed with the real yaml package for:\n${text}`);
}

describe("parseYaml vs the real yaml package", () => {
  test("every seed manifest under catalog/openagents/*/openagent.yaml", (t) => {
    if (!realParse) {
      t.skip("real `yaml` package not available in this environment");
      return;
    }
    if (!fs.existsSync(catalogDir)) {
      t.skip(`catalog dir not found at ${catalogDir}`);
      return;
    }
    const dirs = fs.readdirSync(catalogDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    let checked = 0;
    for (const d of dirs) {
      const manifestPath = path.join(catalogDir, d.name, "openagent.yaml");
      if (!fs.existsSync(manifestPath)) continue;
      const text = fs.readFileSync(manifestPath, "utf8");
      const real = realParse(text);
      const ours = parseYaml(text);
      assert.deepEqual(ours, real, `mismatch for catalog/openagents/${d.name}/openagent.yaml`);
      checked++;
    }
    assert.ok(checked > 0, "expected at least one seed manifest to be checked");
  });

  test("literal block scalar |", (t) => {
    agree(
      t,
      `summary: |
  Line one.
  Line two.
license: MIT
`
    );
  });

  test("literal block scalar |- (strip chomping)", (t) => {
    agree(
      t,
      `summary: |-
  Line one.
  Line two.

license: MIT
`
    );
  });

  test("literal block scalar |+ (keep chomping)", (t) => {
    agree(
      t,
      `summary: |+
  Line one.
  Line two.

license: MIT
`
    );
  });

  test("literal block scalar |+ with leading and trailing blank lines", (t) => {
    agree(t, `body: |+\n\n\n  content\n\n\n`);
  });

  test("folded block scalar >", (t) => {
    agree(
      t,
      `summary: >
  Line one.
  Line two.

  Line three (new para).
license: MIT
`
    );
  });

  test("folded block scalar >- with a more-indented literal line", (t) => {
    agree(
      t,
      `summary: >-
  normal line
    more indented literal
  back to normal
`
    );
  });

  test("block scalar body line that looks like a YAML comment", (t) => {
    agree(
      t,
      `notes: |
  # not a comment, it's content
  more text
license: MIT
`
    );
  });

  test("block scalar nested inside a sequence of mappings", (t) => {
    agree(
      t,
      `nested:
  - name: a
    steps: |
      step 1
      step 2
    other: x
  - name: b
    steps: >
      folded
      text
`
    );
  });

  test("quoted strings containing colons and hashes", (t) => {
    agree(t, `title: "quoted: value with colon"\n`);
    agree(t, `title: 'single: quoted'\n`);
    agree(t, `note: "has a # hash inside quotes"\n`);
  });

  test("inline (flow) arrays", (t) => {
    agree(t, `tags: [a, b, "c: d"]\n`);
    agree(t, `empty: []\n`);
  });

  test("nested inputs (list of mappings with mixed types)", (t) => {
    agree(
      t,
      `inputs:
  - name: pr_ref
    type: string
    required: true
  - name: base_ref
    type: string
    required: false
    default: main
`
    );
  });

  test("unicode content", (t) => {
    agree(t, `unicode: "héllo wörld — 日本語"\n`);
  });
});

describe("parseYaml rejects unsupported constructs with a clear error", () => {
  test("tab indentation", () => {
    assert.throws(() => parseYaml("a: 1\n\tb: 2\n"), /tab indentation is not supported/);
  });

  test("unquoted plain scalar containing a nested ': '", () => {
    assert.throws(() => parseYaml("title: Note: read this\n"), /quote the value/);
  });

  test("unquoted plain scalar ending in a dangling ':'", () => {
    assert.throws(() => parseYaml("title: dangling:\n"), /quote the value/);
  });

  test("real yaml also rejects these two constructs (sanity check that this isn't over-strict)", (t) => {
    if (!realParse) {
      t.skip("real `yaml` package not available in this environment");
      return;
    }
    assert.throws(() => realParse("title: Note: read this\n"));
    assert.throws(() => realParse("a: 1\n\tb: 2\n"));
  });
});
