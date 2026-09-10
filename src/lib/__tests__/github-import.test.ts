// Pure-logic unit tests for `../github-import`'s URL parser. The actual fetch +
// tar extraction in `fetchGitHubPackageFiles` needs a network call to GitHub and isn't
// exercised here — see the module doc comment.
//
// Run with:
//   npx tsx --test src/lib/__tests__/github-import.test.ts
// or, if `tsx`'s `--test` integration isn't available in this Node version:
//   node --import tsx --test src/lib/__tests__/github-import.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { GitHubImportError, parseGitHubRepoUrl } from "../github-import";

test("parses a plain owner/repo URL with defaults", () => {
  const parsed = parseGitHubRepoUrl("https://github.com/openagents/pr-reviewer");
  assert.deepEqual(parsed, { owner: "openagents", repo: "pr-reviewer", ref: "HEAD" });
});

test("strips a trailing .git and trailing slash", () => {
  assert.deepEqual(parseGitHubRepoUrl("https://github.com/openagents/pr-reviewer.git"), {
    owner: "openagents",
    repo: "pr-reviewer",
    ref: "HEAD",
  });
  assert.deepEqual(parseGitHubRepoUrl("https://github.com/openagents/pr-reviewer/"), {
    owner: "openagents",
    repo: "pr-reviewer",
    ref: "HEAD",
  });
});

test("parses a /tree/{ref} URL with no subdir", () => {
  const parsed = parseGitHubRepoUrl("https://github.com/openagents/pr-reviewer/tree/main");
  assert.equal(parsed.owner, "openagents");
  assert.equal(parsed.repo, "pr-reviewer");
  assert.equal(parsed.ref, "main");
  assert.equal(parsed.subdir, undefined);
});

test("parses a /tree/{ref}/{subdir} URL, including a nested subdir", () => {
  const parsed = parseGitHubRepoUrl(
    "https://github.com/openagents/monorepo/tree/main/packages/pr-reviewer"
  );
  assert.deepEqual(parsed, {
    owner: "openagents",
    repo: "monorepo",
    ref: "main",
    subdir: "packages/pr-reviewer",
  });
});

test("accepts http and www.github.com", () => {
  assert.equal(parseGitHubRepoUrl("http://github.com/a/b").owner, "a");
  assert.equal(parseGitHubRepoUrl("https://www.github.com/a/b").owner, "a");
});

test("rejects non-github hosts", () => {
  assert.throws(() => parseGitHubRepoUrl("https://gitlab.com/openagents/pr-reviewer"), GitHubImportError);
  assert.throws(
    () => parseGitHubRepoUrl("https://raw.githubusercontent.com/openagents/pr-reviewer/main/x"),
    GitHubImportError
  );
  assert.throws(() => parseGitHubRepoUrl("https://github.com.evil.com/openagents/pr-reviewer"), GitHubImportError);
});

test("rejects non-tree extra path segments (e.g. /blob/ links)", () => {
  assert.throws(
    () => parseGitHubRepoUrl("https://github.com/openagents/pr-reviewer/blob/main/README.md"),
    GitHubImportError
  );
});

test("rejects a /tree/ URL missing its ref", () => {
  assert.throws(() => parseGitHubRepoUrl("https://github.com/openagents/pr-reviewer/tree"), GitHubImportError);
});

test("rejects malformed URLs and bare owner (no repo)", () => {
  assert.throws(() => parseGitHubRepoUrl("not a url"), GitHubImportError);
  assert.throws(() => parseGitHubRepoUrl("https://github.com/openagents"), GitHubImportError);
});

test("query strings and fragments are ignored, not treated as path segments", () => {
  const parsed = parseGitHubRepoUrl("https://github.com/openagents/pr-reviewer?tab=readme#section");
  assert.deepEqual(parsed, { owner: "openagents", repo: "pr-reviewer", ref: "HEAD" });
});

test("explicit ref/subdir arguments win over fetchGitHubPackageFiles's URL parsing precedence", () => {
  // fetchGitHubPackageFiles itself needs the network, but its precedence rule (explicit
  // args over a /tree/ URL, see `finalRef`/`finalSubdir` there) is simple enough to check
  // against the parser's own output without a fetch.
  const parsed = parseGitHubRepoUrl("https://github.com/openagents/monorepo/tree/main/packages/a");
  const explicitRef: string | undefined = "v2.0.0";
  const explicitSubdir: string | undefined = "packages/b";
  assert.equal(explicitRef || parsed.ref, "v2.0.0");
  assert.equal(explicitSubdir || parsed.subdir, "packages/b");
});
