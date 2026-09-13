// Run via `npm test` (node --import tsx --test) or `npx tsx --test <this file>`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSince, toCatalogExportEntry, updatedSince } from "../catalogExport";
import type { Package } from "../types";

function makePackage(overrides: Partial<Package> = {}): Package {
  return {
    id: "openagents/pr-reviewer",
    owner: "openagents",
    name: "pr-reviewer",
    manifest: {
      schema: 1,
      name: "pr-reviewer",
      owner: "openagents",
      version: "1.2.0",
      kind: "workflow",
      title: "PR Reviewer",
      summary: "Reviews a pull request",
      license: "MIT",
      tags: ["review", "git"],
      runtimes: ["claude-code"],
      pricing: { model: "free", amountCents: 0, currency: "usd" },
      entry: "SKILL.md",
      files: [],
      inputs: [],
      requires: [],
      capabilities: ["review pull request"],
    },
    readme: "",
    files: [],
    versions: [{ version: "1.2.0", publishedAt: "2026-01-01T00:00:00.000Z" }],
    stats: { downloads: 0, stars: 0 },
    featured: false,
    ownerType: "user",
    status: "live",
    source: "seed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseSince", () => {
  test("absent is valid — no filter", () => {
    const result = parseSince(null);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.since, undefined);
  });

  test("parses a valid ISO date-time", () => {
    const result = parseSince("2026-01-01T00:00:00.000Z");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.since?.toISOString(), "2026-01-01T00:00:00.000Z");
  });

  test("accepts a plain date (Date.parse-compatible)", () => {
    const result = parseSince("2026-01-01");
    assert.equal(result.ok, true);
  });

  test("rejects unparseable input", () => {
    const result = parseSince("not-a-date");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /invalid since/);
  });
});

describe("updatedSince", () => {
  const items = [
    { id: "a", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", updatedAt: "2026-01-02T00:00:00.000Z" },
    { id: "c", updatedAt: "2026-01-03T00:00:00.000Z" },
  ];

  test("no since — returns everything", () => {
    assert.equal(updatedSince(items).length, 3);
  });

  test("filters to items updated at or after since", () => {
    const result = updatedSince(items, new Date("2026-01-02T00:00:00.000Z"));
    assert.deepEqual(
      result.map((i) => i.id),
      ["b", "c"]
    );
  });

  test("boundary is inclusive", () => {
    const result = updatedSince(items, new Date("2026-01-03T00:00:00.000Z"));
    assert.deepEqual(
      result.map((i) => i.id),
      ["c"]
    );
  });

  test("a since after every item returns nothing", () => {
    const result = updatedSince(items, new Date("2099-01-01T00:00:00.000Z"));
    assert.equal(result.length, 0);
  });
});

describe("toCatalogExportEntry", () => {
  test("maps manifest + package fields, plus the passed-in sha256", () => {
    const pkg = makePackage();
    const entry = toCatalogExportEntry(pkg, "deadbeef");
    assert.deepEqual(entry, {
      id: "openagents/pr-reviewer",
      owner: "openagents",
      name: "pr-reviewer",
      kind: "workflow",
      title: "PR Reviewer",
      summary: "Reviews a pull request",
      version: "1.2.0",
      license: "MIT",
      tags: ["review", "git"],
      capabilities: ["review pull request"],
      runtimes: ["claude-code"],
      pricing: { model: "free", amountCents: 0, currency: "usd" },
      updatedAt: "2026-01-02T00:00:00.000Z",
      downloadSha256: "deadbeef",
    });
  });
});
