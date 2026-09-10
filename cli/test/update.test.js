import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/commands/update.js";
import { recordInstall, readLockfile } from "../lib/lockfile.js";

const REGISTRY = "https://registry.example";

function tmpProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openagents-update-"));
}

function jsonResponse(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

let originalFetch;
let originalLog;
let originalError;
let originalWarn;
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
  originalWarn = console.warn;
  logs = [];
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  console.warn = (...a) => logs.push(a.join(" "));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  console.error = originalError;
  console.warn = originalWarn;
  process.exitCode = undefined;
});

// A fake installFn that never touches tar/the filesystem, so update.js's
// decision logic (what to update to, lockfile bookkeeping) can be tested
// without a real download+extract pipeline.
function fakeInstall(calls, { fail = false } = {}) {
  return async (opts) => {
    calls.push(opts);
    if (fail) return false;
    recordInstall(opts.projectDir, `${opts.owner}/${opts.name}`, {
      version: opts.version,
      kind: opts.manifest?.kind,
      runtime: opts.runtime,
      path: `.openagents/${opts.name}`,
      installedAt: new Date().toISOString(),
      registry: opts.registry,
      integrity: "sha256-" + "0".repeat(64),
      requestedRange: opts.requestedRange,
    });
    return true;
  };
}

describe("update", () => {
  test("says nothing is installed when the lockfile is empty and no packages were named", async () => {
    const dir = tmpProjectDir();
    await run({ dir, _: [] });
    assert.ok(logs.some((l) => l.includes("No packages installed")));
  });

  test("errors on a named package that isn't installed", async () => {
    const dir = tmpProjectDir();
    await run({ dir, _: ["a/b"] });
    assert.equal(process.exitCode, 1);
    assert.ok(logs.some((l) => l.includes("a/b is not installed")));
  });

  test("reinstalls to the newest version satisfying the recorded range", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.2.0", runtime: "generic", requestedRange: "^1" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions`, jsonResponse({ versions: [{ version: "1.2.0" }, { version: "1.9.0" }, { version: "2.0.0" }] }));
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions/1.9.0`, jsonResponse({ manifest: { owner: "a", name: "b", version: "1.9.0", kind: "workflow" }, status: "live" }));

    const calls = [];
    await run({ dir, registry: REGISTRY, _: [] }, { installFn: fakeInstall(calls) });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].version, "1.9.0");
    assert.equal(readLockfile(dir).packages["a/b"].version, "1.9.0");
    assert.ok(logs.some((l) => l.includes("1.2.0 → 1.9.0")));
  });

  test("--latest ignores the recorded range and goes to the absolute latest", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.2.0", runtime: "generic", requestedRange: "^1" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, jsonResponse({ manifest: { owner: "a", name: "b", version: "3.0.0", kind: "workflow" }, latestVersion: "3.0.0", status: "live" }));

    const calls = [];
    await run({ dir, registry: REGISTRY, latest: true, _: [] }, { installFn: fakeInstall(calls) });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].version, "3.0.0");
  });

  test("prints a no-op message when everything is already up to date", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.9.0", runtime: "generic", requestedRange: "^1" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions`, jsonResponse({ versions: [{ version: "1.9.0" }] }));

    const calls = [];
    await run({ dir, registry: REGISTRY, _: [] }, { installFn: fakeInstall(calls) });

    assert.equal(calls.length, 0);
    assert.ok(logs.some((l) => l.includes("already up to date")));
    assert.equal(process.exitCode, undefined);
  });

  test("no arguments updates every lockfile entry", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.0.0", runtime: "generic", requestedRange: "^1" });
    recordInstall(dir, "c/d", { version: "2.0.0", runtime: "generic", requestedRange: "^2" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions`, jsonResponse({ versions: [{ version: "1.5.0" }] }));
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions/1.5.0`, jsonResponse({ manifest: { owner: "a", name: "b", version: "1.5.0" }, status: "live" }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions`, jsonResponse({ versions: [{ version: "2.0.0" }] }));

    const calls = [];
    await run({ dir, registry: REGISTRY, _: [] }, { installFn: fakeInstall(calls) });

    assert.equal(calls.length, 1); // only a/b changed
    assert.equal(calls[0].owner, "a");
  });

  test("warns but proceeds for a deprecated target version", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.0.0", runtime: "generic" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, jsonResponse({ manifest: { owner: "a", name: "b", version: "1.1.0" }, status: "deprecated", deprecation: { message: "unmaintained" } }));

    const calls = [];
    await run({ dir, registry: REGISTRY, _: [] }, { installFn: fakeInstall(calls) });

    assert.equal(calls.length, 1);
    assert.ok(logs.some((l) => l.includes("deprecated") && l.includes("unmaintained")));
  });

  test("refuses a pending target version", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.0.0", runtime: "generic" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, jsonResponse({ manifest: { owner: "a", name: "b", version: "1.1.0" }, status: "pending" }));

    const calls = [];
    await run({ dir, registry: REGISTRY, _: [] }, { installFn: fakeInstall(calls) });

    assert.equal(calls.length, 0);
    assert.equal(process.exitCode, 1);
    assert.ok(logs.some((l) => l.includes("pending review")));
  });

  test("a failed install is reported and sets exit code 1", async () => {
    const dir = tmpProjectDir();
    recordInstall(dir, "a/b", { version: "1.0.0", runtime: "generic" });
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, jsonResponse({ manifest: { owner: "a", name: "b", version: "1.1.0" }, status: "live" }));

    const calls = [];
    await run({ dir, registry: REGISTRY, _: [] }, { installFn: fakeInstall(calls, { fail: true }) });

    assert.equal(process.exitCode, 1);
  });
});
