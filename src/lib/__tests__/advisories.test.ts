import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { affectsVersion, isValidAdvisorySeverity, ADVISORY_SEVERITIES } from "../advisories";

describe("isValidAdvisorySeverity", () => {
  test("accepts the four documented severities, rejects junk", () => {
    for (const s of ADVISORY_SEVERITIES) assert.equal(isValidAdvisorySeverity(s), true);
    assert.equal(isValidAdvisorySeverity("urgent"), false);
    assert.equal(isValidAdvisorySeverity(""), false);
  });
});

describe("affectsVersion", () => {
  test("null/undefined/empty/'*' range affects every version", () => {
    assert.equal(affectsVersion({ affectedVersions: null }, "1.0.0"), true);
    assert.equal(affectsVersion({ affectedVersions: undefined }, "1.0.0"), true);
    assert.equal(affectsVersion({ affectedVersions: "" }, "1.0.0"), true);
    assert.equal(affectsVersion({ affectedVersions: "   " }, "1.0.0"), true);
    assert.equal(affectsVersion({ affectedVersions: "*" }, "9.9.9"), true);
  });

  test("bare version means exact equality", () => {
    assert.equal(affectsVersion({ affectedVersions: "1.2.3" }, "1.2.3"), true);
    assert.equal(affectsVersion({ affectedVersions: "1.2.3" }, "1.2.4"), false);
  });

  test("comparator operators: <, <=, >, >=, =", () => {
    assert.equal(affectsVersion({ affectedVersions: "<1.3.0" }, "1.2.9"), true);
    assert.equal(affectsVersion({ affectedVersions: "<1.3.0" }, "1.3.0"), false);
    assert.equal(affectsVersion({ affectedVersions: "<=1.3.0" }, "1.3.0"), true);
    assert.equal(affectsVersion({ affectedVersions: ">1.3.0" }, "1.3.1"), true);
    assert.equal(affectsVersion({ affectedVersions: ">1.3.0" }, "1.3.0"), false);
    assert.equal(affectsVersion({ affectedVersions: ">=1.3.0" }, "1.3.0"), true);
    assert.equal(affectsVersion({ affectedVersions: "=2.0.0" }, "2.0.0"), true);
    assert.equal(affectsVersion({ affectedVersions: "=2.0.0" }, "2.0.1"), false);
  });

  test("space-separated tokens are ANDed together (a bounded range)", () => {
    const range = ">=1.0.0 <2.0.0";
    assert.equal(affectsVersion({ affectedVersions: range }, "0.9.9"), false);
    assert.equal(affectsVersion({ affectedVersions: range }, "1.0.0"), true);
    assert.equal(affectsVersion({ affectedVersions: range }, "1.9.9"), true);
    assert.equal(affectsVersion({ affectedVersions: range }, "2.0.0"), false);
  });

  test("caret range: ^1.2.3 means >=1.2.3 <2.0.0", () => {
    const range = "^1.2.3";
    assert.equal(affectsVersion({ affectedVersions: range }, "1.2.2"), false);
    assert.equal(affectsVersion({ affectedVersions: range }, "1.2.3"), true);
    assert.equal(affectsVersion({ affectedVersions: range }, "1.9.0"), true);
    assert.equal(affectsVersion({ affectedVersions: range }, "2.0.0"), false);
  });

  test("caret range with major 0: ^0.2.3 means >=0.2.3 <0.3.0", () => {
    const range = "^0.2.3";
    assert.equal(affectsVersion({ affectedVersions: range }, "0.2.9"), true);
    assert.equal(affectsVersion({ affectedVersions: range }, "0.3.0"), false);
  });

  test("caret range with major 0, minor 0: ^0.0.3 means >=0.0.3 <0.0.4", () => {
    const range = "^0.0.3";
    assert.equal(affectsVersion({ affectedVersions: range }, "0.0.3"), true);
    assert.equal(affectsVersion({ affectedVersions: range }, "0.0.4"), false);
  });

  test("tilde range: ~1.2.3 means >=1.2.3 <1.3.0", () => {
    const range = "~1.2.3";
    assert.equal(affectsVersion({ affectedVersions: range }, "1.2.9"), true);
    assert.equal(affectsVersion({ affectedVersions: range }, "1.3.0"), false);
    assert.equal(affectsVersion({ affectedVersions: range }, "1.2.2"), false);
  });

  test("an unparsable range fails open (advisory still shown)", () => {
    assert.equal(affectsVersion({ affectedVersions: "not-a-range" }, "1.0.0"), true);
    assert.equal(affectsVersion({ affectedVersions: "<not-a-version" }, "1.0.0"), true);
  });

  test("prerelease precedence follows semver: a prerelease is lower than its release", () => {
    assert.equal(affectsVersion({ affectedVersions: "<1.0.0" }, "1.0.0-beta.1"), true);
    assert.equal(affectsVersion({ affectedVersions: ">=1.0.0" }, "1.0.0-beta.1"), false);
  });
});
