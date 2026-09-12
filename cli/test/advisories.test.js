import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/commands/add.js";

const REGISTRY = "https://registry.example";

function tmpProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openagents-add-advisories-"));
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
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
    const key = String(url);
    const handler = routes.get(key);
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
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
  process.exitCode = undefined;
});

function pkgDetail({ owner, name, version, requires = [] }) {
  return jsonResponse({
    manifest: { owner, name, version, requires, kind: "workflow" },
    latestVersion: version,
    status: "live",
    downloadUrl: `${REGISTRY}/api/v1/packages/${owner}/${name}/download`,
  });
}

function advisoriesResponse(items) {
  return jsonResponse({ items });
}

/** A fake install function that never touches tar/the filesystem — same
 *  reasoning as update.test.js's fakeInstall, injected via `run`'s new
 *  `installFn` option so these tests exercise only the advisory-check logic. */
function fakeInstall(calls) {
  return async (opts) => {
    calls.push(opts);
    return true;
  };
}

describe("add: security advisories", () => {
  test("no advisories: nothing printed, install proceeds", async () => {
    const dir = tmpProjectDir();
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0" }));
    routes.set(`${REGISTRY}/api/v1/packages/a/b/advisories`, advisoriesResponse([]));

    const calls = [];
    await run({ _: ["a/b"], registry: REGISTRY, dir }, { installFn: fakeInstall(calls) });

    assert.equal(process.exitCode, undefined);
    assert.equal(calls.length, 1);
    assert.ok(!logs.some((l) => l.includes("Security advisories")));
  });

  test("a moderate/high advisory is printed but does not block install", async () => {
    const dir = tmpProjectDir();
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0" }));
    routes.set(
      `${REGISTRY}/api/v1/packages/a/b/advisories`,
      advisoriesResponse([
        {
          id: "adv1",
          severity: "high",
          title: "Reads SSH keys",
          body: "details",
          affectedVersions: null,
          fixedInVersion: "1.1.0",
          withdrawnAt: null,
        },
      ])
    );

    const calls = [];
    await run({ _: ["a/b"], registry: REGISTRY, dir }, { installFn: fakeInstall(calls) });

    assert.equal(process.exitCode, undefined);
    assert.equal(calls.length, 1);
    assert.ok(logs.some((l) => l.includes("[high] Reads SSH keys (fixed in v1.1.0)")));
  });

  test("a critical advisory affecting the installed version refuses to install (exit 1)", async () => {
    const dir = tmpProjectDir();
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0" }));
    routes.set(
      `${REGISTRY}/api/v1/packages/a/b/advisories`,
      advisoriesResponse([
        {
          id: "adv1",
          severity: "critical",
          title: "Exfiltrates AWS credentials",
          body: "details",
          affectedVersions: null,
          fixedInVersion: null,
          withdrawnAt: null,
        },
      ])
    );

    const calls = [];
    await run({ _: ["a/b"], registry: REGISTRY, dir }, { installFn: fakeInstall(calls) });

    assert.equal(process.exitCode, 1);
    assert.equal(calls.length, 0, "install must not proceed when refused");
    assert.ok(logs.some((l) => l.includes("refusing to install")));
    assert.ok(logs.some((l) => l.includes("--force")));
  });

  test("--force overrides a critical advisory and installs anyway", async () => {
    const dir = tmpProjectDir();
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0" }));
    routes.set(
      `${REGISTRY}/api/v1/packages/a/b/advisories`,
      advisoriesResponse([
        {
          id: "adv1",
          severity: "critical",
          title: "Exfiltrates AWS credentials",
          body: "details",
          affectedVersions: null,
          fixedInVersion: null,
          withdrawnAt: null,
        },
      ])
    );

    const calls = [];
    await run({ _: ["a/b"], registry: REGISTRY, dir, force: true }, { installFn: fakeInstall(calls) });

    assert.equal(process.exitCode, undefined);
    assert.equal(calls.length, 1, "install proceeds with --force");
    assert.ok(logs.some((l) => l.includes("[critical] Exfiltrates AWS credentials")));
  });

  test("a critical advisory scoped to a different version range does not block", async () => {
    const dir = tmpProjectDir();
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "2.0.0" }));
    routes.set(
      `${REGISTRY}/api/v1/packages/a/b/advisories`,
      advisoriesResponse([
        {
          id: "adv1",
          severity: "critical",
          title: "Old exfiltration bug",
          body: "details",
          affectedVersions: "<2.0.0",
          fixedInVersion: "2.0.0",
          withdrawnAt: null,
        },
      ])
    );

    const calls = [];
    await run({ _: ["a/b"], registry: REGISTRY, dir }, { installFn: fakeInstall(calls) });

    assert.equal(process.exitCode, undefined);
    assert.equal(calls.length, 1);
    assert.ok(!logs.some((l) => l.includes("Security advisories")));
  });

  test("a withdrawn critical advisory does not block", async () => {
    const dir = tmpProjectDir();
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0" }));
    routes.set(
      `${REGISTRY}/api/v1/packages/a/b/advisories`,
      advisoriesResponse([
        {
          id: "adv1",
          severity: "critical",
          title: "Fixed already",
          body: "details",
          affectedVersions: null,
          fixedInVersion: "1.0.0",
          withdrawnAt: "2026-01-01T00:00:00.000Z",
        },
      ])
    );

    const calls = [];
    await run({ _: ["a/b"], registry: REGISTRY, dir }, { installFn: fakeInstall(calls) });

    assert.equal(process.exitCode, undefined);
    assert.equal(calls.length, 1);
  });

  test("a registry that can't be reached for advisories warns but doesn't block install", async () => {
    const dir = tmpProjectDir();
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0" }));
    routes.set(`${REGISTRY}/api/v1/packages/a/b/advisories`, jsonResponse({ error: "boom" }, { status: 500 }));

    const calls = [];
    await run({ _: ["a/b"], registry: REGISTRY, dir }, { installFn: fakeInstall(calls) });

    assert.equal(process.exitCode, undefined);
    assert.equal(calls.length, 1);
    assert.ok(logs.some((l) => l.includes("could not check advisories")));
  });
});
