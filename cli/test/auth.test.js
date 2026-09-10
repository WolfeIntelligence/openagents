import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configDir,
  configPath,
  getToken,
  getRegistryRecord,
  setToken,
  clearToken,
} from "../lib/auth.js";

const REGISTRY = "https://openagents-nu.vercel.app";

/** Point OPENAGENTS_CONFIG_DIR at a fresh temp dir for the duration of `t`. */
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

describe("auth: config location", () => {
  test("configDir honors OPENAGENTS_CONFIG_DIR", (t) => {
    const dir = withTmpConfigDir(t);
    assert.equal(configDir(), dir);
    assert.equal(configPath(), path.join(dir, "config.json"));
  });
});

describe("auth: token store", () => {
  test("getToken returns undefined when nothing is stored", (t) => {
    withTmpConfigDir(t);
    assert.equal(getToken(REGISTRY), undefined);
  });

  test("setToken then getToken round-trips, scoped per registry", (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123", { handle: "zach" });
    assert.equal(getToken(REGISTRY), "oa_abc123");
    assert.equal(getToken("https://other.example.com"), undefined);

    const record = getRegistryRecord(REGISTRY);
    assert.equal(record.token, "oa_abc123");
    assert.equal(record.handle, "zach");
    assert.equal(typeof record.savedAt, "string");
  });

  test("setToken writes a file mode 0600 where supported", (t) => {
    const dir = withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    const stat = fs.statSync(path.join(dir, "config.json"));
    if (process.platform !== "win32") {
      assert.equal(stat.mode & 0o777, 0o600);
    }
  });

  test("clearToken removes just that registry's entry and reports whether it removed anything", (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    setToken("https://other.example.com", "oa_def456");

    assert.equal(clearToken(REGISTRY), true);
    assert.equal(getToken(REGISTRY), undefined);
    assert.equal(getToken("https://other.example.com"), "oa_def456");

    assert.equal(clearToken(REGISTRY), false);
  });

  test("OPENAGENTS_TOKEN overrides whatever is stored on disk", (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_fromfile");
    const original = process.env.OPENAGENTS_TOKEN;
    process.env.OPENAGENTS_TOKEN = "oa_fromenv";
    t.after(() => {
      if (original === undefined) delete process.env.OPENAGENTS_TOKEN;
      else process.env.OPENAGENTS_TOKEN = original;
    });
    assert.equal(getToken(REGISTRY), "oa_fromenv");
    assert.equal(getToken("https://unrelated.example.com"), "oa_fromenv");
  });

  test("a malformed config file is treated as empty rather than throwing", (t) => {
    const dir = withTmpConfigDir(t);
    fs.writeFileSync(path.join(dir, "config.json"), "{ not json", "utf8");
    assert.equal(getToken(REGISTRY), undefined);
    assert.equal(getRegistryRecord(REGISTRY), undefined);
  });
});

describe("commands: login", () => {
  function withFetch(t, impl) {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    t.after(() => {
      globalThis.fetch = original;
    });
  }

  test("--token verifies via /api/v1/me and stores it on success", async (t) => {
    withTmpConfigDir(t);
    let seenAuth;
    withFetch(t, async (url, init) => {
      assert.equal(url, `${REGISTRY}/api/v1/me`);
      seenAuth = init.headers.Authorization;
      return {
        ok: true,
        json: async () => ({ id: "u1", handle: "zach", name: "Zach", via: "github", scopes: ["publish", "download"] }),
      };
    });

    const { run } = await import("../lib/commands/login.js");
    const logs = captureConsole();
    try {
      await run({ _: [], token: "oa_abc123" });
    } finally {
      logs.restore();
    }

    assert.equal(seenAuth, "Bearer oa_abc123");
    assert.equal(getToken(REGISTRY), "oa_abc123");
    assert.match(logs.out.join("\n"), /logged in as @zach/);
    assert.match(logs.out.join("\n"), /publish, download/);
  });

  test("an invalid token surfaces the 401 and does not store anything", async (t) => {
    withTmpConfigDir(t);
    withFetch(t, async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid token" }),
    }));

    const { run } = await import("../lib/commands/login.js");
    const logs = captureConsole();
    let exitCode;
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await run({ _: [], token: "oa_bad" });
      exitCode = process.exitCode;
    } finally {
      logs.restore();
      process.exitCode = originalExitCode;
    }

    assert.equal(exitCode, 1);
    assert.equal(getToken(REGISTRY), undefined);
    assert.match(logs.err.join("\n"), /invalid token/);
  });
});

describe("commands: logout", () => {
  test("clears a stored token and says so", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    const { run } = await import("../lib/commands/logout.js");
    const logs = captureConsole();
    try {
      run({ _: [] });
    } finally {
      logs.restore();
    }
    assert.equal(getToken(REGISTRY), undefined);
    assert.match(logs.out.join("\n"), /logged out/);
  });

  test("says so when nothing was stored", async (t) => {
    withTmpConfigDir(t);
    const { run } = await import("../lib/commands/logout.js");
    const logs = captureConsole();
    try {
      run({ _: [] });
    } finally {
      logs.restore();
    }
    assert.match(logs.out.join("\n"), /not logged in/);
  });
});

describe("commands: whoami", () => {
  function withFetch(t, impl) {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    t.after(() => {
      globalThis.fetch = original;
    });
  }

  test("prints the handle and scopes for a stored token", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    withFetch(t, async () => ({
      ok: true,
      json: async () => ({ id: "u1", handle: "zach", via: "github", scopes: ["publish"] }),
    }));

    const { run } = await import("../lib/commands/whoami.js");
    const logs = captureConsole();
    try {
      await run({ _: [] });
    } finally {
      logs.restore();
    }
    assert.match(logs.out.join("\n"), /@zach/);
    assert.match(logs.out.join("\n"), /publish/);
  });

  test("--json prints the raw /api/v1/me body", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_abc123");
    withFetch(t, async () => ({
      ok: true,
      json: async () => ({ id: "u1", handle: "zach", via: "github", scopes: [] }),
    }));

    const { run } = await import("../lib/commands/whoami.js");
    const logs = captureConsole();
    try {
      await run({ _: [], json: true });
    } finally {
      logs.restore();
    }
    const parsed = JSON.parse(logs.out.join("\n"));
    assert.equal(parsed.handle, "zach");
  });

  test("fails cleanly with no stored token", async (t) => {
    withTmpConfigDir(t);
    const { run } = await import("../lib/commands/whoami.js");
    const logs = captureConsole();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    let exitCode;
    try {
      await run({ _: [] });
      exitCode = process.exitCode;
    } finally {
      logs.restore();
      process.exitCode = originalExitCode;
    }
    assert.equal(exitCode, 1);
    assert.match(logs.err.join("\n"), /openagents login/);
  });

  test("a 401 from the registry (revoked token) fails cleanly", async (t) => {
    withTmpConfigDir(t);
    setToken(REGISTRY, "oa_revoked");
    withFetch(t, async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid token" }),
    }));

    const { run } = await import("../lib/commands/whoami.js");
    const logs = captureConsole();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    let exitCode;
    try {
      await run({ _: [] });
      exitCode = process.exitCode;
    } finally {
      logs.restore();
      process.exitCode = originalExitCode;
    }
    assert.equal(exitCode, 1);
    assert.match(logs.err.join("\n"), /invalid token/);
  });
});

/** Capture console.log/console.error output; call .restore() when done. */
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
