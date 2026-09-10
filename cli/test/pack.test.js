import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packDirectory, firstChangelogSection, PackError, MAX_FILE_BYTES, MAX_FILES } from "../lib/pack.js";

function manifestYaml({ name = "demo-rules", entry = "RULES.md", files = ["RULES.md"] } = {}) {
  return [
    "schema: 1",
    `name: ${name}`,
    "owner: zach",
    "version: 1.0.0",
    "kind: rules",
    "title: Demo Rules",
    "summary: A demo package for pack.js tests",
    "license: MIT",
    "tags: [demo]",
    "runtimes: [generic]",
    "pricing:",
    "  model: free",
    "  amount_cents: 0",
    "  currency: usd",
    `entry: ${entry}`,
    "files:",
    ...files.map((f) => `  - ${f}`),
    "inputs: []",
    "requires: []",
    "",
  ].join("\n");
}

function makePackageDir({ files = {}, manifest, skipReadme = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openagents-pack-"));
  fs.writeFileSync(path.join(dir, "openagent.yaml"), manifest ?? manifestYaml(), "utf8");
  if (!skipReadme) {
    fs.writeFileSync(path.join(dir, "README.md"), "# Demo\n\nA demo package.\n", "utf8");
  }
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(full, content);
    } else {
      fs.writeFileSync(full, content, "utf8");
    }
  }
  return dir;
}

describe("packDirectory: happy path", () => {
  test("returns manifest + files including openagent.yaml and README.md", () => {
    const dir = makePackageDir({ files: { "RULES.md": "# Rules\n\nBe nice.\n" } });
    const packed = packDirectory(dir);

    assert.equal(packed.manifest.name, "demo-rules");
    const paths = packed.files.map((f) => f.path).sort();
    assert.deepEqual(paths, ["README.md", "RULES.md", "openagent.yaml"]);

    const rules = packed.files.find((f) => f.path === "RULES.md");
    assert.equal(rules.content, "# Rules\n\nBe nice.\n");
  });

  test("dedupes when a manifest file happens to also be README.md", () => {
    const dir = makePackageDir({
      manifest: manifestYaml({ entry: "README.md", files: ["README.md"] }),
    });
    const packed = packDirectory(dir);
    const paths = packed.files.map((f) => f.path).sort();
    assert.deepEqual(paths, ["README.md", "openagent.yaml"]);
  });
});

describe("packDirectory: validation failures", () => {
  test("missing openagent.yaml raises a PackError", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openagents-pack-"));
    assert.throws(() => packDirectory(dir), (err) => {
      assert.ok(err instanceof PackError);
      assert.ok(err.issues.some((i) => /openagent\.yaml/.test(i)));
      return true;
    });
  });

  test("missing README.md raises a PackError", () => {
    const dir = makePackageDir({ files: { "RULES.md": "# Rules\n" }, skipReadme: true });
    assert.throws(() => packDirectory(dir), (err) => {
      assert.ok(err instanceof PackError);
      assert.ok(err.issues.some((i) => /README\.md/.test(i)));
      return true;
    });
  });

  test("a file listed in the manifest but missing on disk raises a PackError", () => {
    const dir = makePackageDir({
      manifest: manifestYaml({ files: ["RULES.md", "missing.md"] }),
      files: { "RULES.md": "# Rules\n" },
    });
    assert.throws(() => packDirectory(dir), (err) => {
      assert.ok(err instanceof PackError);
      assert.ok(err.issues.some((i) => /missing\.md/.test(i)));
      return true;
    });
  });
});

describe("packDirectory: client-side limits", () => {
  test("rejects binary file content (NUL byte)", () => {
    const dir = makePackageDir({
      files: { "RULES.md": Buffer.from([0x52, 0x55, 0x4c, 0x45, 0x00, 0x53]) },
    });
    assert.throws(() => packDirectory(dir), (err) => {
      assert.ok(err instanceof PackError);
      assert.ok(err.issues.some((i) => /RULES\.md/.test(i) && /binary/.test(i)));
      return true;
    });
  });

  test("rejects a single file over MAX_FILE_BYTES", () => {
    const dir = makePackageDir({
      files: { "RULES.md": "x".repeat(MAX_FILE_BYTES + 1) },
    });
    assert.throws(() => packDirectory(dir), (err) => {
      assert.ok(err instanceof PackError);
      assert.ok(err.issues.some((i) => /RULES\.md/.test(i) && /too large/.test(i)));
      return true;
    });
  });

  test("rejects too many files (over MAX_FILES)", () => {
    const extraCount = MAX_FILES; // + openagent.yaml + README.md + RULES.md pushes it over
    const extraFiles = {};
    const names = [];
    for (let i = 0; i < extraCount; i++) {
      const name = `extra-${i}.md`;
      extraFiles[name] = "content";
      names.push(name);
    }
    extraFiles["RULES.md"] = "# Rules\n";
    const dir = makePackageDir({
      manifest: manifestYaml({ files: ["RULES.md", ...names] }),
      files: extraFiles,
    });
    assert.throws(() => packDirectory(dir), (err) => {
      assert.ok(err instanceof PackError);
      assert.ok(err.issues.some((i) => /too many files/.test(i)));
      return true;
    });
  });
});

describe("firstChangelogSection", () => {
  test("extracts the body of the first heading", () => {
    const text = "## 1.2.0\n\n- fixed X\n- fixed Y\n\n## 1.1.0\n\n- initial\n";
    assert.equal(firstChangelogSection(text), "- fixed X\n- fixed Y");
  });

  test("falls back to the whole trimmed text when there is no heading", () => {
    assert.equal(firstChangelogSection("  just some notes  \n"), "just some notes");
  });

  test("returns undefined for empty content", () => {
    assert.equal(firstChangelogSection("   \n\n"), undefined);
  });
});

describe("packDirectory: changelog extraction", () => {
  test("changelog is the first section of CHANGELOG.md when present", () => {
    const dir = makePackageDir({ files: { "RULES.md": "# Rules\n" } });
    fs.writeFileSync(
      path.join(dir, "CHANGELOG.md"),
      "## 1.0.0\n\n- initial release\n\n## 0.9.0\n\n- prerelease\n",
      "utf8"
    );
    const packed = packDirectory(dir);
    assert.equal(packed.changelog, "- initial release");
    // CHANGELOG.md itself is not uploaded unless listed in manifest.files.
    assert.ok(!packed.files.some((f) => f.path === "CHANGELOG.md"));
  });

  test("no changelog key when CHANGELOG.md is absent", () => {
    const dir = makePackageDir({ files: { "RULES.md": "# Rules\n" } });
    const packed = packDirectory(dir);
    assert.equal(packed.changelog, undefined);
  });
});
