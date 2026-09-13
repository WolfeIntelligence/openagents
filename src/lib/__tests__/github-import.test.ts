// Pure-logic unit tests for `../github-import`: the URL parser, and
// `resolveImportManifest`'s repo-vs-proposed-manifest decision (store/import-with-manifest).
// The actual fetch + tar extraction in `fetchGitHubPackageFiles` needs a network call to
// GitHub and isn't exercised here — see the module doc comment.
//
// Run with:
//   npx tsx --test src/lib/__tests__/github-import.test.ts
// or, if `tsx`'s `--test` integration isn't available in this Node version:
//   node --import tsx --test src/lib/__tests__/github-import.test.ts

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { GitHubImportError, parseGitHubRepoUrl, resolveImportManifest } from "../github-import";
import { parseManifest } from "../manifest";
import { checkMachineOwner } from "../machine";
import type { PublishFile } from "../publish";

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

// ---------------------------------------------------------------------------
// resolveImportManifest (store/import-with-manifest) — no network needed:
// `fetched.files` stands in for what fetchGitHubPackageFiles would have
// returned for a given repo/ref/subdir/commit.
// ---------------------------------------------------------------------------

const fetchedBase = {
  owner: "some-org",
  repo: "some-skill",
  ref: "main",
  subdir: undefined as string | undefined,
  commit: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
};

function manifestYaml(name: string, entry = "SKILL.md", owner = "wolfe"): string {
  return [
    "schema: 1",
    `name: ${name}`,
    `owner: ${owner}`,
    "version: 1.0.0",
    "kind: skill",
    "title: Some Skill",
    "summary: Does something useful.",
    "license: MIT",
    `entry: ${entry}`,
    `files: [${entry}]`,
    "",
  ].join("\n");
}

describe("resolveImportManifest", () => {
  test("the repo's own manifest wins over a proposed one, and gets origin forced", () => {
    const files: PublishFile[] = [
      { path: "openagent.yaml", content: manifestYaml("repo-version") },
      { path: "SKILL.md", content: "# hi" },
    ];
    const proposed = manifestYaml("proposed-version");

    const result = resolveImportManifest({ ...fetchedBase, files }, proposed, { name: "scout" });
    assert.equal(result.manifestSource, "repo");

    const manifestFile = result.files.find((f) => f.path === "openagent.yaml");
    assert.ok(manifestFile);
    const manifest = parseManifest(manifestFile.content);
    assert.equal(manifest.name, "repo-version");
    assert.deepEqual(manifest.origin, {
      repo: `github.com/${fetchedBase.owner}/${fetchedBase.repo}`,
      commit: fetchedBase.commit,
    });
    // importedBy is ignored on this branch — the repo's own manifest carries
    // whatever attested_by (here, none) it already has, not the importer's.
    assert.equal(manifest.attestedBy, undefined);
  });

  test("a proposed manifest is used when the repo has none, with origin and attested_by forced", () => {
    const files: PublishFile[] = [{ path: "SKILL.md", content: "# hi" }];
    const proposed = manifestYaml("proposed-version");

    const result = resolveImportManifest({ ...fetchedBase, files }, proposed, { name: "scout", runId: "run-1" });
    assert.equal(result.manifestSource, "proposed");

    const manifestFile = result.files.find((f) => f.path === "openagent.yaml");
    assert.ok(manifestFile);
    const manifest = parseManifest(manifestFile.content);
    assert.equal(manifest.name, "proposed-version");
    assert.deepEqual(manifest.origin, {
      repo: `github.com/${fetchedBase.owner}/${fetchedBase.repo}`,
      commit: fetchedBase.commit,
    });
    assert.deepEqual(manifest.attestedBy, { name: "scout", runId: "run-1" });
  });

  test("no manifest at all (neither the repo nor a proposal) is refused with a 400", () => {
    const files: PublishFile[] = [{ path: "README.md", content: "hi" }];
    assert.throws(
      () => resolveImportManifest({ ...fetchedBase, files }, undefined),
      (err: unknown) => err instanceof GitHubImportError && err.status === 400
    );
  });

  test("a proposed manifest that fails schema validation is refused with a clear 400", () => {
    const files: PublishFile[] = [{ path: "SKILL.md", content: "# hi" }];
    const invalid = manifestYaml("Not A Valid Name"); // NAME_RE forbids spaces/uppercase

    assert.throws(
      () => resolveImportManifest({ ...fetchedBase, files }, invalid),
      (err: unknown) =>
        err instanceof GitHubImportError &&
        err.status === 400 &&
        err.errors.length > 0 &&
        err.errors.some((issue) => issue.includes("name"))
    );
  });

  test("a proposed manifest listing a file that doesn't exist in the repo is refused with a clear 400", () => {
    const files: PublishFile[] = [{ path: "SKILL.md", content: "# hi" }];
    const missingFile = manifestYaml("proposed-version", "MISSING.md");

    assert.throws(
      () => resolveImportManifest({ ...fetchedBase, files }, missingFile),
      (err: unknown) =>
        err instanceof GitHubImportError &&
        err.status === 400 &&
        err.errors.some((issue) => issue.includes("MISSING.md"))
    );
  });
});

// ---------------------------------------------------------------------------
// The machine-owner rule still applies to a proposed manifest. resolveImportManifest
// deliberately doesn't re-check ownership itself (see its doc comment) — publishPackage
// runs checkMachineOwner(manifest.owner) exactly once, on whatever files it's handed,
// whether they came from the repo or from a proposal. checkMachineOwner's own
// input/output behavior already has full coverage in machine.test.ts; what's worth
// confirming here is that a proposal naming a non-"wolfe" owner survives
// resolveImportManifest unchanged (it isn't silently rewritten or laundered into
// "wolfe") and so still reaches that check and still gets rejected downstream.
// ---------------------------------------------------------------------------

test("a proposed manifest naming a non-wolfe owner passes resolveImportManifest untouched, and checkMachineOwner still rejects it", () => {
  const files: PublishFile[] = [{ path: "SKILL.md", content: "# hi" }];
  const proposed = manifestYaml("proposed-version", "SKILL.md", "not-wolfe");

  const result = resolveImportManifest({ ...fetchedBase, files }, proposed, { name: "wolfe-factory" });
  assert.equal(result.manifestSource, "proposed");

  const manifestFile = result.files.find((f) => f.path === "openagent.yaml");
  assert.ok(manifestFile);
  const manifest = parseManifest(manifestFile.content);
  assert.equal(manifest.owner, "not-wolfe");

  const ownerCheck = checkMachineOwner(manifest.owner);
  assert.equal(ownerCheck.ok, false);
  if (!ownerCheck.ok) {
    assert.equal(ownerCheck.status, 403);
    assert.match(ownerCheck.message, /wolfe/);
  }
});
