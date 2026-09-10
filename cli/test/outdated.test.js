import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/commands/outdated.js";
import { recordInstall } from "../lib/lockfile.js";

const REGISTRY = "https://registry.example";

function tmpProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openagents-outdated-"));
}

function jsonResponse(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

let originalFetch;
let originalLog;
let originalError;
let logs;
let routes;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  routes = new Map();
  globalThis.fetch = async (url) => {
    const handler = routes.get(String(url));
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return typeof handler === "function" ? handler() : handler;
  };
  originalLog = console.log;
  originalError = console.error;
  logs = [];
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  console.error = originalError;
});

describe("outdated", () => {
  test("prints a message and does not fail when nothing is installed", async () => {
    const dir = tmpProjectDir();
    await run({ dir, _: [] });
    assert.equal(process.exitCode, undefined);
    assert.ok(logs.some((l) => l.includes("No packages installed")));
  });

  test("reports current/wanted/latest and exits 0 when up to date", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.2.0", requestedRange: "^1.2.0" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, jsonResponse({ manifest: { version: "1.2.0" }, latestVersion: "1.2.0", status: "live" }));
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions`, jsonResponse({ versions: [{ version: "1.2.0" }] }));

    await run({ dir, registry: REGISTRY, _: [] });
    assert.equal(process.exitCode, undefined);
    assert.ok(logs.some((l) => l.includes("a/b") && l.includes("1.2.0")));
    assert.ok(logs.some((l) => l.includes("up to date")));
    process.exitCode = undefined;
  });

  test("exits 1 and reports wanted vs latest when a newer version exists", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.2.0", requestedRange: "^1" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, jsonResponse({ manifest: { version: "2.0.0" }, latestVersion: "2.0.0", status: "live" }));
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions`, jsonResponse({ versions: [{ version: "1.2.0" }, { version: "1.5.0" }, { version: "2.0.0" }] }));

    await run({ dir, registry: REGISTRY, _: [] });
    assert.equal(process.exitCode, 1);
    const table = logs.join("\n");
    assert.match(table, /a\/b\s+1\.2\.0\s+1\.5\.0\s+2\.0\.0/);
    process.exitCode = undefined;
  });

  test("flags a deprecated package in the table", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.0.0" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, jsonResponse({ manifest: { version: "1.0.0" }, latestVersion: "1.0.0", status: "deprecated" }));

    await run({ dir, registry: REGISTRY, _: [] });
    const table = logs.join("\n");
    assert.match(table, /a\/b\s+1\.0\.0\s+1\.0\.0\s+1\.0\.0\s+yes/);
    process.exitCode = undefined;
  });

  test("supports --json output", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.0.0" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, jsonResponse({ manifest: { version: "1.5.0" }, latestVersion: "1.5.0", status: "live" }));

    await run({ dir, registry: REGISTRY, json: true, _: [] });
    const parsed = JSON.parse(logs.join(""));
    assert.equal(parsed[0].package, "a/b");
    assert.equal(parsed[0].current, "1.0.0");
    assert.equal(parsed[0].latest, "1.5.0");
    process.exitCode = undefined;
  });
});
