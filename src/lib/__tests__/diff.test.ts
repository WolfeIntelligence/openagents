import test from "node:test";
import assert from "node:assert/strict";
import { diffLines } from "../diff";

test("diffLines: identical non-empty files produce no hunks", () => {
  const text = "line one\nline two\nline three\n";
  const result = diffLines(text, text);
  assert.deepEqual(result.hunks, []);
  assert.equal(result.additions, 0);
  assert.equal(result.deletions, 0);
});

test("diffLines: both sides empty produces no hunks", () => {
  const result = diffLines("", "");
  assert.deepEqual(result.hunks, []);
  assert.equal(result.additions, 0);
  assert.equal(result.deletions, 0);
});

test("diffLines: added file (old side empty) is a single all-insert hunk", () => {
  const result = diffLines("", "a\nb\nc\n");
  assert.equal(result.additions, 3);
  assert.equal(result.deletions, 0);
  assert.equal(result.hunks.length, 1);
  const hunk = result.hunks[0];
  assert.equal(hunk.oldLines, 0);
  assert.equal(hunk.newLines, 3);
  assert.equal(hunk.newStart, 1);
  assert.deepEqual(
    hunk.lines.map((l) => l.type),
    ["+", "+", "+"]
  );
  assert.deepEqual(
    hunk.lines.map((l) => l.text),
    ["a", "b", "c"]
  );
});

test("diffLines: removed file (new side empty) is a single all-delete hunk", () => {
  const result = diffLines("a\nb\nc\n", "");
  assert.equal(result.additions, 0);
  assert.equal(result.deletions, 3);
  assert.equal(result.hunks.length, 1);
  const hunk = result.hunks[0];
  assert.equal(hunk.oldLines, 3);
  assert.equal(hunk.newLines, 0);
  assert.equal(hunk.oldStart, 1);
  assert.deepEqual(
    hunk.lines.map((l) => l.type),
    ["-", "-", "-"]
  );
});

test("diffLines: a single-line modification in the middle keeps context around it", () => {
  const oldText = "one\ntwo\nthree\nfour\nfive\n";
  const newText = "one\ntwo\nCHANGED\nfour\nfive\n";
  const result = diffLines(oldText, newText);
  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 1);
  assert.equal(result.hunks.length, 1);
  const hunk = result.hunks[0];
  // Default context is 3, and there are only 2 lines of context on either
  // side of the change here, so the whole 5-line file lands in one hunk.
  assert.equal(hunk.oldStart, 1);
  assert.equal(hunk.oldLines, 5);
  assert.equal(hunk.newStart, 1);
  assert.equal(hunk.newLines, 5);
  const types = hunk.lines.map((l) => l.type).join("");
  assert.equal(types, "  -+  ");
  assert.equal(hunk.lines[2].text, "three");
  assert.equal(hunk.lines[3].text, "CHANGED");
});

test("diffLines: a pure line insertion reports only additions", () => {
  const oldText = "a\nb\nc\n";
  const newText = "a\nb\nNEW\nc\n";
  const result = diffLines(oldText, newText);
  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 0);
});

test("diffLines: a pure line removal reports only deletions", () => {
  const oldText = "a\nb\nc\n";
  const newText = "a\nc\n";
  const result = diffLines(oldText, newText);
  assert.equal(result.additions, 0);
  assert.equal(result.deletions, 1);
});

test("diffLines: changes far apart split into separate hunks", () => {
  const oldLines = Array.from({ length: 40 }, (_, i) => `line${i}`);
  const newLines = [...oldLines];
  newLines[1] = "CHANGED-NEAR-TOP";
  newLines[38] = "CHANGED-NEAR-BOTTOM";
  const result = diffLines(oldLines.join("\n") + "\n", newLines.join("\n") + "\n");
  assert.equal(result.additions, 2);
  assert.equal(result.deletions, 2);
  assert.equal(result.hunks.length, 2);
});

test("diffLines: no trailing-newline phantom line — 'a\\nb\\n' is two lines, not three", () => {
  const result = diffLines("a\nb\n", "a\nb\nc\n");
  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 0);
});

test("diffLines: large input with scattered changes stays correct and completes quickly", () => {
  const size = 5000;
  const oldLines = Array.from({ length: size }, (_, i) => `line number ${i}`);
  const newLines = [...oldLines];
  // Scatter ~50 changes evenly through the file.
  let expectedChanges = 0;
  for (let i = 100; i < size; i += 100) {
    newLines[i] = `CHANGED ${i}`;
    expectedChanges++;
  }
  const start = Date.now();
  const result = diffLines(oldLines.join("\n"), newLines.join("\n"));
  const elapsedMs = Date.now() - start;

  assert.equal(result.additions, expectedChanges);
  assert.equal(result.deletions, expectedChanges);
  assert.ok(elapsedMs < 5000, `expected diffLines to finish quickly, took ${elapsedMs}ms`);
});

test("diffLines: respects a custom contextLines value", () => {
  const oldText = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n");
  const lines = oldText.split("\n");
  lines[5] = "CHANGED";
  const newText = lines.join("\n");

  const wide = diffLines(oldText, newText, 4);
  const narrow = diffLines(oldText, newText, 1);
  assert.ok(wide.hunks[0].lines.length > narrow.hunks[0].lines.length);
  // The changed line becomes one delete + one insert (old text != new text),
  // plus 1 line of context on each side: 4 lines total.
  assert.equal(narrow.hunks[0].lines.length, 4);
});
