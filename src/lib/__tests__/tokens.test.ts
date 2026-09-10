// Pure-logic unit tests for `../tokens` (format/hash/parse) and the scope check in
// `../requester`. The DB-backed exports (createToken/listTokens/revokeToken/verifyToken)
// need a real Postgres connection and are exercised by hand against a dev database, not
// here — see the module doc comments for why every export is zero-env safe regardless.
//
// Run with:
//   npx tsx --test src/lib/__tests__/tokens.test.ts
// or, if `tsx`'s `--test` integration isn't available in this Node version:
//   node --import tsx --test src/lib/__tests__/tokens.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TOKEN_RE, TOKEN_SCOPES, hashToken, parseToken } from "../tokens";
import { hasScope, type Requester } from "../requester";

test("TOKEN_RE matches oa_ + 40 lowercase hex chars", () => {
  assert.equal(TOKEN_RE.test(`oa_${"a".repeat(40)}`), true);
  assert.equal(TOKEN_RE.test(`oa_${"0123456789abcdef".repeat(3).slice(0, 40)}`), true);
});

test("TOKEN_RE rejects wrong prefix, length, and case", () => {
  assert.equal(TOKEN_RE.test(`oa_${"a".repeat(39)}`), false, "too short");
  assert.equal(TOKEN_RE.test(`oa_${"a".repeat(41)}`), false, "too long");
  assert.equal(TOKEN_RE.test(`oa_${"A".repeat(40)}`), false, "uppercase hex");
  assert.equal(TOKEN_RE.test(`sk_${"a".repeat(40)}`), false, "wrong prefix");
  assert.equal(TOKEN_RE.test(`oa_${"g".repeat(40)}`), false, "non-hex char");
  assert.equal(TOKEN_RE.test(""), false, "empty string");
});

test("parseToken extracts the first 8 hex chars after oa_ as the prefix", () => {
  const token = `oa_${"1234567890abcdef".repeat(3).slice(0, 40)}`;
  const parsed = parseToken(token);
  assert.ok(parsed);
  assert.equal(parsed.prefix, "12345678");
  assert.equal(parsed.prefix.length, 8);
});

test("parseToken returns null for anything not shaped like a token", () => {
  assert.equal(parseToken("not-a-token"), null);
  assert.equal(parseToken(`oa_${"a".repeat(39)}`), null);
  assert.equal(parseToken(`Bearer oa_${"a".repeat(40)}`), null);
});

test("hashToken is a stable, deterministic sha256 hex digest", () => {
  const token = `oa_${"a".repeat(40)}`;
  const expected = createHash("sha256").update(token).digest("hex");
  assert.equal(hashToken(token), expected);
  assert.equal(hashToken(token), hashToken(token));
  assert.equal(hashToken(token).length, 64);
});

test("hashToken produces different digests for different tokens", () => {
  const a = hashToken(`oa_${"a".repeat(40)}`);
  const b = hashToken(`oa_${"b".repeat(40)}`);
  assert.notEqual(a, b);
});

test("TOKEN_SCOPES is exactly the four documented scopes", () => {
  assert.deepEqual([...TOKEN_SCOPES].sort(), ["download", "publish", "read", "star"]);
});

test("hasScope: a session requester may do anything regardless of its scopes list", () => {
  const session: Requester = { id: "u1", via: "session", scopes: [] };
  for (const scope of TOKEN_SCOPES) {
    assert.equal(hasScope(session, scope), true);
  }
});

test("hasScope: a token requester is limited to its granted scopes", () => {
  const readOnly: Requester = { id: "u1", via: "token", scopes: ["read"] };
  assert.equal(hasScope(readOnly, "read"), true);
  assert.equal(hasScope(readOnly, "publish"), false);
  assert.equal(hasScope(readOnly, "star"), false);
  assert.equal(hasScope(readOnly, "download"), false);

  const full: Requester = { id: "u1", via: "token", scopes: [...TOKEN_SCOPES] };
  for (const scope of TOKEN_SCOPES) {
    assert.equal(hasScope(full, scope), true);
  }
});

test("hasScope: null requester (unauthenticated) may do nothing", () => {
  for (const scope of TOKEN_SCOPES) {
    assert.equal(hasScope(null, scope), false);
  }
});
