import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPlan, fetchResolvedPackage, formatPlan } from "../lib/resolve.js";
import { recordInstall } from "../lib/lockfile.js";

const REGISTRY = "https://registry.example";

function tmpProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openagents-resolve-"));
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Install a fake `fetch` keyed by exact URL, restored in `afterEach`. */
let originalFetch;
let routes;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  routes = new Map();
  globalThis.fetch = async (url) => {
    const key = String(url);
    const handler = routes.get(key);
    if (!handler) {
      throw new Error(`unexpected fetch: ${key}`);
    }
    return typeof handler === "function" ? handler() : handler;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function pkgDetail({ owner, name, version, requires = [], status = "live", deprecation, latestVersion }) {
  return jsonResponse({
    manifest: { owner, name, version, requires, kind: "workflow" },
    latestVersion: latestVersion || version,
    status,
    deprecation,
    downloadUrl: `${REGISTRY}/api/v1/packages/${owner}/${name}/download`,
  });
}

function versionDetail({ owner, name, version, requires = [], status = "live", deprecation }) {
  return jsonResponse({
    manifest: { owner, name, version, requires, kind: "workflow" },
    status,
    deprecation,
    downloadUrl: `${REGISTRY}/api/v1/packages/${owner}/${name}/versions/${version}/download`,
  });
}

function versionsList({ owner, name, versions }) {
  return jsonResponse({ versions: versions.map((version) => ({ version, publishedAt: "2026-01-01T00:00:00.000Z" })) });
}

const noisyLog = { log: () => {}, warn: () => {} };

describe("fetchResolvedPackage", () => {
  test("no range -> fetches the plain package-detail endpoint (latest)", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.2.0" }));
    const resolved = await fetchResolvedPackage({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic" });
    assert.equal(resolved.version, "1.2.0");
    assert.equal(resolved.status, "live");
  });

  test("an exact version selector fetches /versions/{v} directly", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions/1.0.0`, versionDetail({ owner: "a", name: "b", version: "1.0.0" }));
    const resolved = await fetchResolvedPackage({ owner: "a", name: "b", range: "1.0.0", registry: REGISTRY, runtime: "generic" });
    assert.equal(resolved.version, "1.0.0");
    assert.equal(resolved.downloadUrl, `${REGISTRY}/api/v1/packages/a/b/versions/1.0.0/download`);
  });

  test("a range resolves via /versions + maxSatisfying", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions`, versionsList({ owner: "a", name: "b", versions: ["1.0.0", "1.2.0", "1.5.0", "2.0.0"] }));
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions/1.5.0`, versionDetail({ owner: "a", name: "b", version: "1.5.0" }));
    const resolved = await fetchResolvedPackage({ owner: "a", name: "b", range: "^1", registry: REGISTRY, runtime: "generic" });
    assert.equal(resolved.version, "1.5.0");
  });

  test("throws a clear error when no published version satisfies the range", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b/versions`, versionsList({ owner: "a", name: "b", versions: ["1.0.0"] }));
    await assert.rejects(
      fetchResolvedPackage({ owner: "a", name: "b", range: "^2", registry: REGISTRY, runtime: "generic" }),
      /no published version of a\/b satisfies "\^2"/
    );
  });
});

describe("buildPlan", () => {
  test("resolves a single package with no dependencies", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0" }));
    const dir = tmpProjectDir();
    const plan = await buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, ...noisyLog });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, "a/b");
    assert.equal(plan[0].version, "1.0.0");
    assert.equal(plan[0].reason, "requested");
  });

  test("resolves transitive requires depth-first", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0", requires: ["c/d@^1"] }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions`, versionsList({ owner: "c", name: "d", versions: ["1.0.0", "1.4.0"] }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions/1.4.0`, versionDetail({ owner: "c", name: "d", version: "1.4.0" }));
    const dir = tmpProjectDir();
    const plan = await buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, ...noisyLog });
    assert.equal(plan.length, 2);
    assert.equal(plan[0].id, "a/b");
    assert.equal(plan[1].id, "c/d");
    assert.equal(plan[1].version, "1.4.0");
    assert.equal(plan[1].reason, "required by a/b@1.0.0");
  });

  test("--no-deps resolves only the root", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0", requires: ["c/d@^1"] }));
    const dir = tmpProjectDir();
    const plan = await buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, noDeps: true, ...noisyLog });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, "a/b");
  });

  test("detects a dependency cycle instead of looping forever", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0", requires: ["c/d@^1"] }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions`, versionsList({ owner: "c", name: "d", versions: ["1.0.0"] }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions/1.0.0`, versionDetail({ owner: "c", name: "d", version: "1.0.0", requires: ["a/b@^1"] }));
    const dir = tmpProjectDir();
    await assert.rejects(
      buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, ...noisyLog }),
      /dependency cycle detected: a\/b -> c\/d -> a\/b/
    );
  });

  test("reports a clear conflict when two packages require incompatible ranges of the same dependency", async () => {
    routes.set(
      `${REGISTRY}/api/v1/packages/a/b`,
      pkgDetail({ owner: "a", name: "b", version: "1.0.0", requires: ["x/y@^1", "c/d@^1"] })
    );
    routes.set(`${REGISTRY}/api/v1/packages/x/y/versions`, versionsList({ owner: "x", name: "y", versions: ["1.0.0"] }));
    routes.set(`${REGISTRY}/api/v1/packages/x/y/versions/1.0.0`, versionDetail({ owner: "x", name: "y", version: "1.0.0" }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions`, versionsList({ owner: "c", name: "d", versions: ["1.0.0"] }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions/1.0.0`, versionDetail({ owner: "c", name: "d", version: "1.0.0", requires: ["x/y@^2"] }));
    const dir = tmpProjectDir();
    await assert.rejects(
      buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, ...noisyLog }),
      /dependency version conflict: a\/b@1\.0\.0 needs x\/y@\^1, but c\/d@1\.0\.0 needs x\/y@\^2/
    );
  });

  test("a compatible second requirement on an already-planned dependency is not a conflict", async () => {
    routes.set(
      `${REGISTRY}/api/v1/packages/a/b`,
      pkgDetail({ owner: "a", name: "b", version: "1.0.0", requires: ["x/y@^1.2.0", "c/d@^1"] })
    );
    routes.set(`${REGISTRY}/api/v1/packages/x/y/versions`, versionsList({ owner: "x", name: "y", versions: ["1.5.0"] }));
    routes.set(`${REGISTRY}/api/v1/packages/x/y/versions/1.5.0`, versionDetail({ owner: "x", name: "y", version: "1.5.0" }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions`, versionsList({ owner: "c", name: "d", versions: ["1.0.0"] }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions/1.0.0`, versionDetail({ owner: "c", name: "d", version: "1.0.0", requires: ["x/y@^1"] }));
    const dir = tmpProjectDir();
    const plan = await buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, ...noisyLog });
    const ids = plan.map((p) => p.id);
    assert.deepEqual(ids, ["a/b", "x/y", "c/d"]);
    assert.equal(plan.filter((p) => p.id === "x/y").length, 1); // resolved once, reused for c/d
  });

  test("reuses a lockfile entry that already satisfies the requested range", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0", requires: ["c/d@^1"] }));
    const dir = tmpProjectDir();
    recordInstall(dir, "c/d", { version: "1.2.0" });
    const messages = [];
    const plan = await buildPlan({
      owner: "a",
      name: "b",
      range: undefined,
      registry: REGISTRY,
      runtime: "generic",
      projectDir: dir,
      log: (m) => messages.push(m),
      warn: () => {},
    });
    const cd = plan.find((p) => p.id === "c/d");
    assert.equal(cd.version, "1.2.0");
    assert.equal(cd.cached, true);
    assert.ok(messages.some((m) => m.includes("using cached c/d@1.2.0")));
  });

  test("does not reuse a lockfile entry that no longer satisfies the requested range", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0", requires: ["c/d@^2"] }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions`, versionsList({ owner: "c", name: "d", versions: ["2.0.0"] }));
    routes.set(`${REGISTRY}/api/v1/packages/c/d/versions/2.0.0`, versionDetail({ owner: "c", name: "d", version: "2.0.0" }));
    const dir = tmpProjectDir();
    recordInstall(dir, "c/d", { version: "1.2.0" });
    const plan = await buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, ...noisyLog });
    const cd = plan.find((p) => p.id === "c/d");
    assert.equal(cd.version, "2.0.0");
    assert.ok(!cd.cached);
  });

  test("warns but proceeds for a deprecated package", async () => {
    routes.set(
      `${REGISTRY}/api/v1/packages/a/b`,
      pkgDetail({ owner: "a", name: "b", version: "1.0.0", status: "deprecated", deprecation: { message: "use c/d instead", replacementId: "c/d" } })
    );
    const dir = tmpProjectDir();
    const warnings = [];
    const plan = await buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, log: () => {}, warn: (m) => warnings.push(m) });
    assert.equal(plan.length, 1);
    assert.ok(warnings.some((m) => m.includes("deprecated") && m.includes("use c/d instead") && m.includes("c/d")));
  });

  test("refuses a pending package with a clear message", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0", status: "pending" }));
    const dir = tmpProjectDir();
    await assert.rejects(
      buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, ...noisyLog }),
      /a\/b@1\.0\.0 is pending review and cannot be installed yet/
    );
  });

  test("refuses an unknown status with a clear message", async () => {
    routes.set(`${REGISTRY}/api/v1/packages/a/b`, pkgDetail({ owner: "a", name: "b", version: "1.0.0", status: "quarantined" }));
    const dir = tmpProjectDir();
    await assert.rejects(
      buildPlan({ owner: "a", name: "b", range: undefined, registry: REGISTRY, runtime: "generic", projectDir: dir, ...noisyLog }),
      /a\/b@1\.0\.0 has unknown status "quarantined"/
    );
  });
});

describe("formatPlan", () => {
  test("renders each entry with its reason", () => {
    const text = formatPlan([
      { id: "a/b", version: "1.0.0", reason: "requested" },
      { id: "c/d", version: "1.2.0", reason: "required by a/b@1.0.0", cached: true },
    ]);
    assert.match(text, /a\/b@1\.0\.0 {2}— requested/);
    assert.match(text, /c\/d@1\.2\.0 \(cached\) {2}— required by a\/b@1\.0\.0/);
  });
});
