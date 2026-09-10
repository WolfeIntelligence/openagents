import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setToken, getToken } from "../lib/auth.js";

const REGISTRY = "https://openagents-nu.vercel.app";

function manifestYaml() {
  return [
    "schema: 1",
    "name: demo-rules",
    "owner: zach",
    "version: 1.0.0",
    "kind: rules",
    "title: Demo Rules",
    "summary: A demo package for publish.js tests",
    "license: MIT",
    "tags: [demo]",
    "runtimes: [generic]",
    "pricing:",
    "  model: free",
    "  amount_cents: 0",
    "  currency: usd",
    "entry: RULES.md",
    "files:",
    "  - RULES.md",
    "inputs: []",
    "requires: []",
    "",
  ].join("\n");
}

function makePackageDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openagents-publish-"));
  fs.writeFileSync(path.join(dir, "openagent.yaml"), manifestYaml(), "utf8");
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo\n", "utf8");
  fs.writeFileSync(path.join(dir, "RULES.md"), "# Rules\n\nBe nice.\n", "utf8");
  return dir;
}

function withTmpConfigDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openagents-config-"));
  const original = process.env.OPENAGENTS_CONFIG_DIR;
  process.env.OPENAGENTS_CONFIG_DIR = dir;
  t.after(() => {
    if (original === undefined) delete process.env.OPENAGENTS_CONFIG_DIR;
    else process.env.OPENAGENTS_CONFIG_DIR = original;
  });
  return dir;
}

function withFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
  });
}

function captureConsole() {
  const out = [];
  const err = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => out.push(args.join(" "));
  console.error = (...args) => err.push(args.join(" "));
  return {
    out,
    err,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

async function runPublish(args) {
  const { run } = await import("../lib/commands/publish.js");
  const logs = captureConsole();
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await run(args);
    return { exitCode: process.exitCode, ...logs };
  } finally {
    logs.restore();
    process.exitCode = originalExitCode;
  }
}

describe("publish: dry-run", () => {
  test("packs and prints a summary without making a network request", async (t) => {
    withTmpConfigDir(t);
    const dir = makePackageDir();
    let fetchCalled = false;
    withFetch(t, async () => {
      fetchCalled = true;
      throw new Error("should not be called in --dry-run");
    });

    const { exitCode, out } = await runPublish({ _: [dir], "dry-run": true });
    assert.equal(exitCode, undefined);
    assert.equal(fetchCalled, false);
    const text = out.join("\n");
    assert.match(text, /zach\/demo-rules@1\.0\.0/);
    assert.match(text, /kind:\s+rules/);
    assert.match(text, /files:\s+3/);
    assert.match(text, /price:\s+free/);
    assert.match(text, /dry run/);
  });

  test("missing token (no dry-run) fails cleanly with a hint to log in", async (t) => {
    withTmpConfigDir(t);
    const dir = makePackageDir();
    const { exitCode, err } = await runPublish({ _: [dir] });
    assert.equal(exitCode, 1);
    assert.match(err.join("\n"), /openagents login/);
  });
});

describe("publish: success", () => {
  test("POSTs files with the bearer token and prints the result", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    const dir = makePackageDir();

    let seenUrl, seenInit;
    withFetch(t, async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return {
        ok: true,
        json: async () => ({ id: "zach/demo-rules", version: "1.0.0", url: `${REGISTRY}/p/zach/demo-rules`, status: "published" }),
      };
    });

    const { exitCode, out } = await runPublish({ _: [dir] });
    assert.equal(exitCode, undefined);
    assert.equal(seenUrl, `${REGISTRY}/api/v1/publish`);
    assert.equal(seenInit.method, "POST");
    assert.equal(seenInit.headers.Authorization, "Bearer oa_abc123");
    const body = JSON.parse(seenInit.body);
    assert.equal(body.files.length, 3);

    const text = out.join("\n");
    assert.match(text, /published zach\/demo-rules@1\.0\.0/);
    assert.match(text, new RegExp(`${REGISTRY}/p/zach/demo-rules`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  test("a pending status is called out", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    const dir = makePackageDir();
    withFetch(t, async () => ({
      ok: true,
      json: async () => ({ id: "zach/demo-rules", version: "1.0.0", url: `${REGISTRY}/p/zach/demo-rules`, status: "pending" }),
    }));

    const { out } = await runPublish({ _: [dir] });
    assert.match(out.join("\n"), /pending.*awaiting review/s);
  });

  test("--changelog overrides CHANGELOG.md's extracted section", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    const dir = makePackageDir();
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "## 1.0.0\n\n- from file\n", "utf8");

    let seenInit;
    withFetch(t, async (url, init) => {
      seenInit = init;
      return { ok: true, json: async () => ({ id: "zach/demo-rules", version: "1.0.0", url: "x", status: "published" }) };
    });

    await runPublish({ _: [dir], changelog: "from flag" });
    const body = JSON.parse(seenInit.body);
    assert.equal(body.changelog, "from flag");
  });
});

describe("publish: server errors", () => {
  test("401 surfaces the registry's message", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_expired");
    const dir = makePackageDir();
    withFetch(t, async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid token" }),
    }));

    const { exitCode, err } = await runPublish({ _: [dir] });
    assert.equal(exitCode, 1);
    assert.match(err.join("\n"), /invalid token/);
  });

  test("400 with issues[] lists each issue", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    const dir = makePackageDir();
    withFetch(t, async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({ error: "invalid manifest", issues: ["name: required", "version: required"] }),
    }));

    const { exitCode, err } = await runPublish({ _: [dir] });
    assert.equal(exitCode, 1);
    const text = err.join("\n");
    assert.match(text, /invalid manifest/);
    assert.match(text, /name: required/);
    assert.match(text, /version: required/);
  });

  test("409 (version exists) suggests bumping the version", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    const dir = makePackageDir();
    withFetch(t, async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: "zach/demo-rules@1.0.0 already exists" }),
    }));

    const { exitCode, err } = await runPublish({ _: [dir] });
    assert.equal(exitCode, 1);
    const text = err.join("\n");
    assert.match(text, /already exists/);
    assert.match(text, /bump the version/);
  });
});

describe("publish: local pack failures never reach the network", () => {
  test("an invalid package directory fails before any fetch call", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openagents-publish-bad-"));
    let fetchCalled = false;
    withFetch(t, async () => {
      fetchCalled = true;
      throw new Error("should not be called");
    });

    const { exitCode, err } = await runPublish({ _: [dir] });
    assert.equal(exitCode, 1);
    assert.equal(fetchCalled, false);
    assert.match(err.join("\n"), /openagent\.yaml/);
  });
});

describe("publish: --from-github", () => {
  test("dry-run prints the target without posting", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    let fetchCalled = false;
    withFetch(t, async () => {
      fetchCalled = true;
      throw new Error("should not be called");
    });

    const { out } = await runPublish({
      _: [],
      "from-github": "https://github.com/zach/demo",
      ref: "main",
      "dry-run": true,
    });
    assert.equal(fetchCalled, false);
    assert.match(out.join("\n"), /github\.com\/zach\/demo/);
  });

  test("posts to /api/v1/publish/import with the given repo/ref/subdir", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    let seenUrl, seenBody;
    withFetch(t, async (url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ id: "zach/demo", version: "1.0.0", url: `${REGISTRY}/p/zach/demo`, status: "published" }),
      };
    });

    await runPublish({
      _: [],
      "from-github": "https://github.com/zach/demo",
      ref: "main",
      subdir: "packages/demo",
    });
    assert.equal(seenUrl, `${REGISTRY}/api/v1/publish/import`);
    assert.deepEqual(seenBody, { repo: "https://github.com/zach/demo", ref: "main", subdir: "packages/demo" });
  });
});
