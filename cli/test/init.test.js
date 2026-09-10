import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run as initRun } from "../lib/commands/init.js";
import { parseManifest, validateManifest, validateManifestFiles } from "../lib/manifest.js";
import { listFilesRecursive } from "../lib/util.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openagents-init-"));
}

function validateDir(dir) {
  const raw = fs.readFileSync(path.join(dir, "openagent.yaml"), "utf8");
  const manifest = parseManifest(raw); // throws if the generated YAML is unparseable
  const issues = validateManifest(manifest);
  const available = listFilesRecursive(dir).filter((p) => p !== "openagent.yaml");
  issues.push(...validateManifestFiles(manifest, available));
  return { manifest, issues };
}

describe("init -> validate round-trip (regression: generated YAML must itself be valid)", () => {
  test("default template (kind: workflow)", () => {
    const dir = tmpDir();
    initRun({ _: [], dir, kind: "workflow", name: "my-workflow" });
    const { manifest, issues } = validateDir(dir);
    assert.deepEqual(issues, []);
    assert.equal(manifest.name, "my-workflow");
    assert.equal(manifest.entry, "WORKFLOW.md");
  });

  test("every kind scaffolds a manifest that validates cleanly", () => {
    for (const kind of ["workflow", "harness", "rules", "skill"]) {
      const dir = tmpDir();
      initRun({ _: [], dir, kind, name: `my-${kind}` });
      const { issues } = validateDir(dir);
      assert.deepEqual(issues, [], `kind=${kind}`);
    }
  });

  test("--version writes the given semver (B13a) and it round-trips through validate", () => {
    const dir = tmpDir();
    initRun({ _: [], dir, kind: "skill", name: "versioned", version: "2.3.1" });
    const { manifest, issues } = validateDir(dir);
    assert.equal(manifest.version, "2.3.1");
    assert.deepEqual(issues, []);
  });

  test("a title/summary containing a colon is quoted and still parses (regression)", () => {
    const dir = tmpDir();
    initRun({
      _: [],
      dir,
      kind: "skill",
      name: "colon-case",
      title: "Note: read this first",
      summary: "Does: the thing, precisely",
    });
    const { manifest, issues } = validateDir(dir);
    assert.equal(manifest.title, "Note: read this first");
    assert.equal(manifest.summary, "Does: the thing, precisely");
    assert.deepEqual(issues, []);
  });
});
