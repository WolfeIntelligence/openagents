// Pure-logic unit tests for `../sources` — signature verification, webhook event
// classification, repo URL parsing, and the version-sync decision. The DB-backed
// exports (linkSource, getSourceById, ...) need a database and aren't exercised here,
// same rationale as `github-import.test.ts` skipping the network fetch.
//
// Run with:
//   npx tsx --test src/lib/__tests__/sources.test.ts
// or, if `tsx`'s `--test` integration isn't available in this Node version:
//   node --import tsx --test src/lib/__tests__/sources.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  classifyEvent,
  decideSync,
  formatRepo,
  parseRepoInput,
  payloadRepoFullName,
  sameRepo,
  SourceError,
  verifySignature,
} from "../sources";

// ---------------------------------------------------------------------------
// parseRepoInput / formatRepo / sameRepo
// ---------------------------------------------------------------------------

test("parseRepoInput: accepts plain owner/repo shorthand", () => {
  assert.deepEqual(parseRepoInput("openagents/pr-reviewer"), {
    owner: "openagents",
    repo: "pr-reviewer",
  });
});

test("parseRepoInput: accepts a full github.com URL", () => {
  assert.deepEqual(parseRepoInput("https://github.com/openagents/pr-reviewer"), {
    owner: "openagents",
    repo: "pr-reviewer",
  });
});

test("parseRepoInput: strips a trailing .git and a scheme-less github.com/ prefix", () => {
  assert.deepEqual(parseRepoInput("https://github.com/openagents/pr-reviewer.git"), {
    owner: "openagents",
    repo: "pr-reviewer",
  });
  assert.deepEqual(parseRepoInput("github.com/openagents/pr-reviewer"), {
    owner: "openagents",
    repo: "pr-reviewer",
  });
});

test("parseRepoInput: rejects a non-github.com host", () => {
  assert.throws(() => parseRepoInput("https://gitlab.com/openagents/pr-reviewer"), SourceError);
});

test("parseRepoInput: rejects extra path segments (ref/subdir belong in their own fields)", () => {
  assert.throws(() => parseRepoInput("https://github.com/openagents/pr-reviewer/tree/main"), SourceError);
});

test("parseRepoInput: rejects malformed owner/repo shorthand", () => {
  assert.throws(() => parseRepoInput("not-a-repo"), SourceError);
  assert.throws(() => parseRepoInput("a/b/c"), SourceError);
  assert.throws(() => parseRepoInput(""), SourceError);
});

test("formatRepo: joins owner and repo with a slash", () => {
  assert.equal(formatRepo({ owner: "openagents", repo: "pr-reviewer" }), "openagents/pr-reviewer");
});

test("sameRepo: case-insensitive comparison", () => {
  assert.equal(sameRepo("OpenAgents/PR-Reviewer", "openagents/pr-reviewer"), true);
  assert.equal(sameRepo("openagents/pr-reviewer", "openagents/other"), false);
});

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

test("verifySignature: accepts a correctly signed body", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ hello: "world" });
  assert.equal(verifySignature(body, sign(secret, body), secret), true);
});

test("verifySignature: rejects a wrong secret", () => {
  const body = JSON.stringify({ hello: "world" });
  assert.equal(verifySignature(body, sign("wrong-secret", body), "test-secret"), false);
});

test("verifySignature: rejects a tampered body", () => {
  const secret = "test-secret";
  const original = JSON.stringify({ hello: "world" });
  const tampered = JSON.stringify({ hello: "mallory" });
  assert.equal(verifySignature(tampered, sign(secret, original), secret), false);
});

test("verifySignature: rejects a missing or malformed header", () => {
  const secret = "test-secret";
  const body = "{}";
  assert.equal(verifySignature(body, null, secret), false);
  assert.equal(verifySignature(body, undefined, secret), false);
  assert.equal(verifySignature(body, "not-a-signature", secret), false);
  assert.equal(verifySignature(body, "sha1=deadbeef", secret), false);
});

// ---------------------------------------------------------------------------
// classifyEvent / payloadRepoFullName
// ---------------------------------------------------------------------------

test("classifyEvent: ping is answered directly", () => {
  assert.deepEqual(classifyEvent("ping", {}), { kind: "ping" });
});

test("classifyEvent: a published release imports at its tag", () => {
  const decision = classifyEvent("release", { action: "published", release: { tag_name: "v1.2.0" } });
  assert.deepEqual(decision, { kind: "import", ref: "v1.2.0" });
});

test("classifyEvent: a draft/unpublished release action is ignored", () => {
  assert.deepEqual(
    classifyEvent("release", { action: "created", release: { tag_name: "v1.2.0" } }),
    { kind: "ignored" }
  );
  assert.deepEqual(classifyEvent("release", { action: "published", release: {} }), { kind: "ignored" });
});

test("classifyEvent: a tag push imports at the pushed tag", () => {
  assert.deepEqual(classifyEvent("push", { ref: "refs/tags/v2.0.0" }), { kind: "import", ref: "v2.0.0" });
});

test("classifyEvent: a branch push is ignored", () => {
  assert.deepEqual(classifyEvent("push", { ref: "refs/heads/main" }), { kind: "ignored" });
});

test("classifyEvent: an unrelated event type is ignored", () => {
  assert.deepEqual(classifyEvent("issues", { action: "opened" }), { kind: "ignored" });
});

test("payloadRepoFullName: reads repository.full_name, undefined when absent/malformed", () => {
  assert.equal(payloadRepoFullName({ repository: { full_name: "acme/widgets" } }), "acme/widgets");
  assert.equal(payloadRepoFullName({}), undefined);
  assert.equal(payloadRepoFullName({ repository: { full_name: 42 } }), undefined);
  assert.equal(payloadRepoFullName(null), undefined);
});

// ---------------------------------------------------------------------------
// decideSync
// ---------------------------------------------------------------------------

test("decideSync: publishes when the imported version is strictly greater", () => {
  assert.deepEqual(decideSync("1.1.0", "1.0.0"), { publish: true });
});

test("decideSync: skips an equal or lower version", () => {
  const equal = decideSync("1.0.0", "1.0.0");
  assert.equal(equal.publish, false);
  assert.match((equal as { message: string }).message, /not greater/);

  const lower = decideSync("0.9.0", "1.0.0");
  assert.equal(lower.publish, false);
});

test("decideSync: does not throw on an unparseable version, skips instead", () => {
  const decision = decideSync("not-a-version", "1.0.0");
  assert.equal(decision.publish, false);
});
