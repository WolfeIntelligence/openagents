import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLockfile, recordInstall, removeInstall, lockfilePath } from "../lib/lockfile.js";

function tmpProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openagents-lockfile-"));
}

describe("lockfile", () => {
  test("readLockfile returns an empty shape when no file exists", () => {
    const dir = tmpProjectDir();
    assert.deepEqual(readLockfile(dir), { packages: {} });
  });

  test("recordInstall creates the file and is idempotent / mergeable", () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "openagents/pr-reviewer", {
      version: "1.0.0",
      kind: "workflow",
      runtime: "claude-code",
      path: ".claude/skills/pr-reviewer",
      installedAt: "2026-01-01T00:00:00.000Z",
      registry: "https://openagents-nu.vercel.app",
    });
    assert.ok(fs.existsSync(lockfilePath(dir)));

    let data = readLockfile(dir);
    assert.equal(data.packages["openagents/pr-reviewer"].version, "1.0.0");

    // Re-running (e.g. an upgrade) merges rather than duplicating.
    recordInstall(dir, "openagents/pr-reviewer", { version: "1.1.0" });
    data = readLockfile(dir);
    assert.equal(Object.keys(data.packages).length, 1);
    assert.equal(data.packages["openagents/pr-reviewer"].version, "1.1.0");
    assert.equal(data.packages["openagents/pr-reviewer"].kind, "workflow"); // merged, not replaced

    recordInstall(dir, "someone/other-pkg", { version: "2.0.0" });
    data = readLockfile(dir);
    assert.equal(Object.keys(data.packages).length, 2);
  });

  test("removeInstall deletes just that entry", () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.0.0" });
    recordInstall(dir, "c/d", { version: "1.0.0" });
    removeInstall(dir, "a/b");
    const data = readLockfile(dir);
    assert.deepEqual(Object.keys(data.packages), ["c/d"]);
  });

  test("a malformed lockfile is treated as empty rather than throwing", () => {
    const dir = tmpProjectDir();
    fs.mkdirSync(path.join(dir, ".openagents"), { recursive: true });
    fs.writeFileSync(lockfilePath(dir), "{ not json", "utf8");
    assert.deepEqual(readLockfile(dir), { packages: {} });
  });
});
