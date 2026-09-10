import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSemver, isGreater, parseSemver, SemverError } from "../semver";

test("parseSemver: valid versions", () => {
  assert.deepEqual(parseSemver("1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: [],
    build: [],
  });
  assert.deepEqual(parseSemver("0.0.0"), {
    major: 0,
    minor: 0,
    patch: 0,
    prerelease: [],
    build: [],
  });
  assert.deepEqual(parseSemver("1.0.0-alpha.1"), {
    major: 1,
    minor: 0,
    patch: 0,
    prerelease: ["alpha", 1],
    build: [],
  });
  assert.deepEqual(parseSemver("1.0.0+build.5"), {
    major: 1,
    minor: 0,
    patch: 0,
    prerelease: [],
    build: ["build", "5"],
  });
  assert.deepEqual(parseSemver("1.0.0-beta+exp.sha.5114f85"), {
    major: 1,
    minor: 0,
    patch: 0,
    prerelease: ["beta"],
    build: ["exp", "sha", "5114f85"],
  });
});

test("parseSemver: rejects invalid input", () => {
  for (const bad of [
    "1.2",
    "1.2.3.4",
    "v1.2.3",
    "1.2.03", // leading zero on a numeric identifier
    "01.2.3",
    "1.2.3-",
    "1.2.3-01", // leading zero on numeric prerelease identifier
    "not-a-version",
    "",
  ]) {
    assert.throws(() => parseSemver(bad), SemverError, `expected "${bad}" to be rejected`);
  }
  // The one exception: surrounding whitespace is trimmed before validation.
  assert.doesNotThrow(() => parseSemver(" 1.2.3 "));
});

test("compareSemver: numeric major/minor/patch ordering", () => {
  assert.equal(compareSemver("1.0.0", "2.0.0"), -1);
  assert.equal(compareSemver("2.0.0", "1.0.0"), 1);
  assert.equal(compareSemver("1.2.0", "1.10.0"), -1); // numeric, not lexical
  assert.equal(compareSemver("1.1.9", "1.1.10"), -1);
  assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
});

test("compareSemver: prerelease has lower precedence than release", () => {
  assert.equal(compareSemver("1.0.0-alpha", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0", "1.0.0-alpha"), 1);
});

test("compareSemver: prerelease identifiers compared per semver.org §11 example", () => {
  // 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2
  // < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.equal(
      compareSemver(ordered[i], ordered[i + 1]),
      -1,
      `expected ${ordered[i]} < ${ordered[i + 1]}`
    );
    assert.equal(
      compareSemver(ordered[i + 1], ordered[i]),
      1,
      `expected ${ordered[i + 1]} > ${ordered[i]}`
    );
  }
});

test("compareSemver: numeric identifiers have lower precedence than alphanumeric ones", () => {
  assert.equal(compareSemver("1.0.0-1", "1.0.0-alpha"), -1);
});

test("compareSemver: build metadata is ignored", () => {
  assert.equal(compareSemver("1.0.0+build1", "1.0.0+build2"), 0);
  assert.equal(compareSemver("1.0.0-alpha+1", "1.0.0-alpha+2"), 0);
  assert.equal(compareSemver("1.0.0+build1", "1.0.0"), 0);
});

test("isGreater", () => {
  assert.equal(isGreater("1.2.1", "1.2.0"), true);
  assert.equal(isGreater("1.2.0", "1.2.0"), false);
  assert.equal(isGreater("1.1.9", "1.2.0"), false);
  assert.equal(isGreater("2.0.0", "1.9.9"), true);
  assert.equal(isGreater("1.0.0", "1.0.0-rc.1"), true);
});
