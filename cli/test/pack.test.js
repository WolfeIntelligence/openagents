import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  packDirectory,
  firstChangelogSection,
  PackError,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_BINARY_BYTES,
} from "../lib/pack.js";

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

describe("packDirectory: binary file handling", () => {
  test("binary content (NUL byte) is base64-encoded with encoding: \"base64\"", () => {
    const binaryContent = Buffer.from([0x52, 0x55, 0x4c, 0x45, 0x00, 0x53]);
    const dir = makePackageDir({
      manifest: manifestYaml({ files: ["RULES.md", "blob.bin"] }),
      files: { "RULES.md": "# Rules\n", "blob.bin": binaryContent },
    });
    const packed = packDirectory(dir);

    const blob = packed.files.find((f) => f.path === "blob.bin");
    assert.equal(blob.encoding, "base64");
    assert.ok(Buffer.from(blob.content, "base64").equals(binaryContent));

    const rules = packed.files.find((f) => f.path === "RULES.md");
    assert.equal(rules.encoding, undefined);
    assert.equal(rules.content, "# Rules\n");
  });

  test("content that isn't valid UTF-8 (no NUL byte) is also treated as binary", () => {
    const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x0d, 0x0a]);
    const dir = makePackageDir({
      manifest: manifestYaml({ files: ["RULES.md", "logo.png"] }),
      files: { "RULES.md": "# Rules\n", "logo.png": binaryContent },
    });
    const packed = packDirectory(dir);
    const logo = packed.files.find((f) => f.path === "logo.png");
    assert.equal(logo.encoding, "base64");
    assert.ok(Buffer.from(logo.content, "base64").equals(binaryContent));
  });

  test("rejects a binary file over MAX_BINARY_BYTES", () => {
    const big = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(MAX_BINARY_BYTES, 0x41)]);
    const dir = makePackageDir({
      manifest: manifestYaml({ files: ["RULES.md", "blob.bin"] }),
      files: { "RULES.md": "# Rules\n", "blob.bin": big },
    });
    assert.throws(() => packDirectory(dir), (err) => {
      assert.ok(err instanceof PackError);
      assert.ok(err.issues.some((i) => /blob\.bin/.test(i) && /too large/.test(i)));
      return true;
    });
  });
});

describe("packDirectory: file modes", () => {
  test(".sh files and extensionless files under bin/ or scripts/ are marked executable (0o755)", () => {
    const dir = makePackageDir({
      manifest: manifestYaml({ files: ["RULES.md", "bin/run", "scripts/deploy.sh", "lib/util.js"] }),
      files: {
        "RULES.md": "# Rules\n",
        "bin/run": "#!/bin/sh\necho hi\n",
        "scripts/deploy.sh": "#!/bin/sh\necho deploy\n",
        "lib/util.js": "module.exports = {};\n",
      },
    });
    const packed = packDirectory(dir);
    const modeOf = (p) => packed.files.find((f) => f.path === p)?.mode;

    assert.equal(modeOf("bin/run"), 0o755);
    assert.equal(modeOf("scripts/deploy.sh"), 0o755);
    assert.equal(modeOf("lib/util.js"), undefined);
    assert.equal(modeOf("RULES.md"), undefined);
  });

  test("honors a real POSIX executable bit when set", { skip: process.platform === "win32" }, () => {
    const dir = makePackageDir({
      manifest: manifestYaml({ files: ["RULES.md", "tool.js"] }),
      files: { "RULES.md": "# Rules\n", "tool.js": "#!/usr/bin/env node\n" },
    });
    fs.chmodSync(path.join(dir, "tool.js"), 0o755);
    const packed = packDirectory(dir);
    assert.equal(packed.files.find((f) => f.path === "tool.js").mode, 0o755);
  });
});

describe("packDirectory: client-side limits", () => {
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
