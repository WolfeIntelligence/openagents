// Run via `npm test` (node --import tsx --test) or `npx tsx --test <this file>`.
//
// Mutates process.env for each case and restores it afterwards — these tests
// must not run concurrently with each other (node:test runs a file's tests
// sequentially by default; we don't opt into concurrency here).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { siteUrl, absoluteUrl } from "../site";

const ENV_KEYS = ["NEXT_PUBLIC_SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("siteUrl precedence", () => {
  test("falls back to localhost with zero env vars", () => {
    assert.equal(siteUrl(), "http://localhost:3000");
  });

  test("uses VERCEL_URL when set", () => {
    process.env.VERCEL_URL = "my-app-git-branch.vercel.app";
    assert.equal(siteUrl(), "https://my-app-git-branch.vercel.app");
  });

  test("prefers VERCEL_PROJECT_PRODUCTION_URL over VERCEL_URL", () => {
    process.env.VERCEL_URL = "my-app-git-branch.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "openagents-nu.vercel.app";
    assert.equal(siteUrl(), "https://openagents-nu.vercel.app");
  });

  test("prefers NEXT_PUBLIC_SITE_URL over everything", () => {
    process.env.VERCEL_URL = "my-app-git-branch.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "openagents-nu.vercel.app";
    process.env.NEXT_PUBLIC_SITE_URL = "https://openagents.example";
    assert.equal(siteUrl(), "https://openagents.example");
  });

  test("trims a trailing slash from NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://openagents.example/";
    assert.equal(siteUrl(), "https://openagents.example");
  });

  test("trims whitespace and ignores a blank NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    assert.equal(siteUrl(), "http://localhost:3000");
  });
});

describe("absoluteUrl", () => {
  test("joins a path onto siteUrl()", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://openagents.example";
    assert.equal(absoluteUrl("/sitemap.xml"), "https://openagents.example/sitemap.xml");
  });

  test("adds the leading slash if missing", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://openagents.example";
    assert.equal(absoluteUrl("explore"), "https://openagents.example/explore");
  });

  test("defaults to the root path", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://openagents.example";
    assert.equal(absoluteUrl(), "https://openagents.example/");
  });
});
