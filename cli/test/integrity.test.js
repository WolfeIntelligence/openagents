import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  sha256Hex,
  toIntegrityString,
  parseIntegrityString,
  expectedChecksumFromHeaders,
  verifyChecksum,
} from "../lib/integrity.js";

function hashOf(str) {
  return createHash("sha256").update(str).digest("hex");
}

describe("sha256Hex", () => {
  test("matches node:crypto directly", () => {
    const buf = Buffer.from("hello world");
    assert.equal(sha256Hex(buf), hashOf("hello world"));
  });

  test("different content hashes differently", () => {
    assert.notEqual(sha256Hex(Buffer.from("a")), sha256Hex(Buffer.from("b")));
  });
});

describe("toIntegrityString / parseIntegrityString", () => {
  test("round-trips a hex digest", () => {
    const hex = hashOf("payload");
    const str = toIntegrityString(hex);
    assert.equal(str, `sha256-${hex}`);
    assert.equal(parseIntegrityString(str), hex);
  });

  test("lowercases the digest on the way in and out", () => {
    const hex = hashOf("payload");
    const str = toIntegrityString(hex.toUpperCase());
    assert.equal(str, `sha256-${hex}`);
    assert.equal(parseIntegrityString(`SHA256-${hex.toUpperCase()}`), hex);
  });

  test("parseIntegrityString returns null for non sha256 strings", () => {
    assert.equal(parseIntegrityString("md5-deadbeef"), null);
    assert.equal(parseIntegrityString(""), null);
    assert.equal(parseIntegrityString(undefined), null);
    assert.equal(parseIntegrityString("sha256-tooshort"), null);
  });
});

describe("expectedChecksumFromHeaders", () => {
  test("reads X-Checksum-Sha256 from a Headers instance", () => {
    const hex = hashOf("x");
    const headers = new Headers({ "X-Checksum-Sha256": hex });
    assert.equal(expectedChecksumFromHeaders(headers), hex);
  });

  test("falls back to a quoted ETag shaped like a sha256 hex digest", () => {
    const hex = hashOf("y");
    const headers = new Headers({ ETag: `"${hex}"` });
    assert.equal(expectedChecksumFromHeaders(headers), hex);
  });

  test("falls back to an unquoted ETag", () => {
    const hex = hashOf("z");
    const headers = new Headers({ etag: hex });
    assert.equal(expectedChecksumFromHeaders(headers), hex);
  });

  test("prefers X-Checksum-Sha256 over ETag when both are present", () => {
    const a = hashOf("a");
    const b = hashOf("b");
    const headers = new Headers({ "X-Checksum-Sha256": a, ETag: `"${b}"` });
    assert.equal(expectedChecksumFromHeaders(headers), a);
  });

  test("returns null when neither header is present or usable", () => {
    assert.equal(expectedChecksumFromHeaders(new Headers()), null);
    assert.equal(expectedChecksumFromHeaders(new Headers({ ETag: '"not-a-hash"' })), null);
    assert.equal(expectedChecksumFromHeaders(null), null);
  });

  test("works with a plain object, case-insensitively", () => {
    const hex = hashOf("plain");
    assert.equal(expectedChecksumFromHeaders({ "x-checksum-sha256": hex }), hex);
  });
});

describe("verifyChecksum", () => {
  test("does not throw on a match (case-insensitive)", () => {
    const hex = hashOf("match");
    assert.doesNotThrow(() => verifyChecksum(hex.toUpperCase(), hex));
  });

  test("throws a clear error on mismatch", () => {
    assert.throws(() => verifyChecksum(hashOf("a"), hashOf("b"), { label: "openagents/foo@1.0.0" }), /integrity check failed for openagents\/foo@1\.0\.0/);
  });

  test("is a no-op when there is nothing to check against", () => {
    assert.doesNotThrow(() => verifyChecksum(hashOf("anything"), null));
    assert.doesNotThrow(() => verifyChecksum(hashOf("anything"), undefined));
  });
});
