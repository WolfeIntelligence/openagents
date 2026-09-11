// Pure-logic unit tests for the helpers in `../collections` — slug
// derivation, item ordering/position normalization, and the install-all
// command builder. No database or Next.js runtime needed.
//
// Run with: npm test (see scripts/run-tests.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInstallAllCommand,
  COLLECTION_SLUG_PATTERN,
  deriveSlug,
  isValidSlug,
  nextPosition,
  normalizePositions,
} from "../collections";

// ---------------------------------------------------------------------------
// deriveSlug / isValidSlug
// ---------------------------------------------------------------------------

test("deriveSlug: lowercases and hyphenates a normal title", () => {
  assert.equal(deriveSlug("My Favorite Review Workflows"), "my-favorite-review-workflows");
});

test("deriveSlug: collapses punctuation/whitespace runs into one dash", () => {
  assert.equal(deriveSlug("RAG   Harnesses & Tools!!"), "rag-harnesses-tools");
});

test("deriveSlug: trims leading/trailing dashes left by non-alnum edges", () => {
  assert.equal(deriveSlug("--Cool Stuff--"), "cool-stuff");
});

test("deriveSlug: truncates to 64 characters", () => {
  const long = "a".repeat(100);
  const slug = deriveSlug(long);
  assert.equal(slug.length, 64);
  assert.match(slug, COLLECTION_SLUG_PATTERN);
});

test("deriveSlug: falls back to a generic slug when nothing survives", () => {
  assert.equal(deriveSlug("!!!"), "collection");
  assert.equal(deriveSlug(""), "collection");
});

test("deriveSlug: pads a single surviving character to satisfy the min length", () => {
  const slug = deriveSlug("a!!!");
  assert.match(slug, COLLECTION_SLUG_PATTERN);
});

test("deriveSlug: every output matches isValidSlug/COLLECTION_SLUG_PATTERN", () => {
  for (const title of ["Hello World", "日本語のタイトル", "  spaced  ", "Already-a-slug"]) {
    assert.ok(isValidSlug(deriveSlug(title)), `deriveSlug(${JSON.stringify(title)}) should be valid`);
  }
});

test("isValidSlug: rejects uppercase, underscores, and too-short/too-long strings", () => {
  assert.equal(isValidSlug("Valid-Slug"), false);
  assert.equal(isValidSlug("has_underscore"), false);
  assert.equal(isValidSlug("a"), false);
  assert.equal(isValidSlug("a".repeat(65)), false);
  assert.equal(isValidSlug("ok-slug"), true);
});

// ---------------------------------------------------------------------------
// normalizePositions / nextPosition
// ---------------------------------------------------------------------------

test("normalizePositions: closes gaps and sorts by position", () => {
  const items = [
    { owner: "a", name: "one", position: 5 },
    { owner: "a", name: "two", position: 1 },
    { owner: "a", name: "three", position: 9 },
  ];
  const result = normalizePositions(items);
  assert.deepEqual(
    result.map((i) => i.name),
    ["two", "one", "three"]
  );
  assert.deepEqual(
    result.map((i) => i.position),
    [0, 1, 2]
  );
});

test("normalizePositions: stable for duplicate positions (keeps input order)", () => {
  const items = [
    { name: "a", position: 0 },
    { name: "b", position: 0 },
    { name: "c", position: 0 },
  ];
  const result = normalizePositions(items);
  assert.deepEqual(
    result.map((i) => i.name),
    ["a", "b", "c"]
  );
  assert.deepEqual(
    result.map((i) => i.position),
    [0, 1, 2]
  );
});

test("normalizePositions: does not mutate the input array or its items", () => {
  const items = [{ name: "a", position: 3 }];
  const result = normalizePositions(items);
  assert.equal(items[0].position, 3, "original item should be untouched");
  assert.notEqual(result[0], items[0], "should return new objects");
});

test("normalizePositions: empty list stays empty", () => {
  assert.deepEqual(normalizePositions([]), []);
});

test("nextPosition: 0 for an empty collection", () => {
  assert.equal(nextPosition([]), 0);
});

test("nextPosition: one past the highest existing position", () => {
  assert.equal(nextPosition([{ position: 0 }, { position: 4 }, { position: 2 }]), 5);
});

// ---------------------------------------------------------------------------
// buildInstallAllCommand
// ---------------------------------------------------------------------------

test("buildInstallAllCommand: empty collection yields an empty string", () => {
  assert.equal(buildInstallAllCommand([], "openagents-cli"), "");
});

test("buildInstallAllCommand: one package", () => {
  assert.equal(
    buildInstallAllCommand([{ owner: "openagents", name: "pr-reviewer" }], "openagents-cli"),
    "npx openagents-cli add openagents/pr-reviewer"
  );
});

test("buildInstallAllCommand: multiple packages chain with && in order, one line", () => {
  const cmd = buildInstallAllCommand(
    [
      { owner: "a", name: "one" },
      { owner: "b", name: "two" },
    ],
    "openagents"
  );
  assert.equal(cmd, "npx openagents-cli add a/one && npx openagents-cli add b/two");
  assert.equal(cmd.includes("\n"), false, "must be a single line");
});

test("buildInstallAllCommand: honors a full URL/tgz cli spec, not just a package name", () => {
  const cmd = buildInstallAllCommand(
    [{ owner: "a", name: "one" }],
    "https://example.com/cli/openagents.tgz"
  );
  assert.equal(cmd, "npx https://example.com/cli/openagents.tgz add a/one");
});
