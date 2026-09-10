import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  splitPackageRef,
  formatPrice,
  isPathInside,
  responseError,
  fetchJson,
  userAgent,
  cliVersion,
} from "../lib/util.js";

describe("splitPackageRef", () => {
  test("plain owner/name", () => {
    assert.deepEqual(splitPackageRef("openagents/pr-reviewer"), {
      owner: "openagents",
      name: "pr-reviewer",
      version: undefined,
    });
  });

  test("owner/name@version", () => {
    assert.deepEqual(splitPackageRef("openagents/pr-reviewer@1.2.0"), {
      owner: "openagents",
      name: "pr-reviewer",
      version: "1.2.0",
    });
  });

  test("name with slashes still splits owner off the front", () => {
    assert.deepEqual(splitPackageRef("owner/nested/name@2.0.0"), {
      owner: "owner",
      name: "nested/name",
      version: "2.0.0",
    });
  });

  test("rejects missing slash", () => {
    assert.throws(() => splitPackageRef("no-slash"), /expected a package reference/);
  });

  test("rejects empty/undefined", () => {
    assert.throws(() => splitPackageRef(""), /expected a package reference/);
    assert.throws(() => splitPackageRef(undefined), /expected a package reference/);
  });
});

describe("formatPrice", () => {
  test("formats cents as currency", () => {
    assert.equal(formatPrice(500, "usd"), "$5.00");
    assert.equal(formatPrice(0, "usd"), "$0.00");
  });

  test("defaults to usd", () => {
    assert.equal(formatPrice(1234), "$12.34");
  });
});

describe("isPathInside", () => {
  test("true for a nested path", () => {
    assert.equal(isPathInside("/proj", "/proj/.claude/skills/x"), true);
  });

  test("true for the same path", () => {
    assert.equal(isPathInside("/proj", "/proj"), true);
  });

  test("false for a sibling or ancestor", () => {
    assert.equal(isPathInside("/proj", "/other"), false);
    assert.equal(isPathInside("/proj/sub", "/proj"), false);
  });
});

describe("userAgent / cliVersion", () => {
  test("includes the CLI version and runtime", () => {
    const version = cliVersion();
    assert.match(userAgent("claude-code"), new RegExp(`^openagents-cli/${version} \\(claude-code\\)$`));
  });

  test("defaults runtime to unknown", () => {
    assert.match(userAgent(), /\(unknown\)$/);
    assert.match(userAgent(undefined), /\(unknown\)$/);
  });
});

describe("responseError", () => {
  function fakeResponse(status, bodyText) {
    return { status, text: async () => bodyText };
  }

  test("prefers the server's JSON {error} over a raw dump", async () => {
    const res = fakeResponse(402, JSON.stringify({ error: "purchase required to download this package" }));
    const err = await responseError("https://x/y", res, "GET");
    assert.equal(err.message, "purchase required to download this package");
    assert.equal(err.status, 402);
    assert.equal(err.body.error, "purchase required to download this package");
  });

  test("appends issues when present", async () => {
    const res = fakeResponse(400, JSON.stringify({ error: "invalid manifest", issues: ["name: required", "version: required"] }));
    const err = await responseError("https://x/y", res, "POST");
    assert.equal(err.message, "invalid manifest: name: required; version: required");
  });

  test("falls back to a raw dump when the body isn't {error}", async () => {
    const res = fakeResponse(500, "<html>oops</html>");
    const err = await responseError("https://x/y", res, "GET");
    assert.match(err.message, /HTTP 500/);
    assert.match(err.message, /<html>oops<\/html>/);
    assert.equal(err.body, null);
  });
});

describe("fetchJson", () => {
  test("surfaces the server error message on non-2xx", async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: "package not found: nope/doesnotexist" }),
    });
    await assert.rejects(
      () => fetchJson("https://x/api/v1/packages/nope/doesnotexist"),
      /package not found: nope\/doesnotexist/
    );
  });

  test("sends a User-Agent header", async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });
    let seenHeaders;
    globalThis.fetch = async (url, init) => {
      seenHeaders = init.headers;
      return { ok: true, json: async () => ({ ok: true }) };
    };
    await fetchJson("https://x/y", { runtime: "cursor" });
    assert.match(seenHeaders["User-Agent"], /^openagents-cli\/.+\(cursor\)$/);
  });
});
