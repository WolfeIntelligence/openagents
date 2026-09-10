import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parse,
  tryParse,
  valid,
  compare,
  gt,
  lt,
  eq,
  satisfies,
  maxSatisfying,
  SemverError,
} from "../lib/semver.js";

describe("parse", () => {
  test("parses a plain release version", () => {
    assert.deepEqual(parse("1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: [], build: [] });
  });

  test("parses prerelease identifiers, converting numeric ones", () => {
    assert.deepEqual(parse("1.2.3-beta.2").prerelease, ["beta", 2]);
  });

  test("parses build metadata, kept but ignored for comparison", () => {
    assert.deepEqual(parse("1.2.3+build.5").build, ["build", "5"]);
  });

  test("accepts a leading v", () => {
    assert.deepEqual(parse("v1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: [], build: [] });
  });

  test("rejects leading zeros in numeric components", () => {
    assert.throws(() => parse("01.2.3"), SemverError);
  });

  test("rejects a missing patch version", () => {
    assert.throws(() => parse("1.2"), SemverError);
  });

  test("rejects garbage", () => {
    assert.throws(() => parse("not-a-version"), SemverError);
  });

  test("tryParse returns null instead of throwing", () => {
    assert.equal(tryParse("nope"), null);
    assert.ok(tryParse("1.0.0"));
  });

  test("valid() reports well-formedness", () => {
    assert.equal(valid("1.0.0"), true);
    assert.equal(valid("1.0"), false);
  });
});

describe("compare", () => {
  test("orders by major, then minor, then patch", () => {
    assert.equal(compare("2.0.0", "1.9.9"), 1);
    assert.equal(compare("1.2.0", "1.10.0"), -1);
    assert.equal(compare("1.2.3", "1.2.4"), -1);
    assert.equal(compare("1.2.3", "1.2.3"), 0);
  });

  test("a release has higher precedence than its prerelease", () => {
    assert.equal(compare("1.0.0", "1.0.0-alpha"), 1);
    assert.equal(compare("1.0.0-alpha", "1.0.0"), -1);
  });

  test("prerelease identifiers compare numerically when both numeric", () => {
    assert.equal(compare("1.0.0-alpha.1", "1.0.0-alpha.2"), -1);
    assert.equal(compare("1.0.0-alpha.10", "1.0.0-alpha.2"), 1); // numeric, not lexical
  });

  test("numeric prerelease identifiers have lower precedence than alphanumeric", () => {
    assert.equal(compare("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
  });

  test("a longer prerelease list has higher precedence when the shared prefix is equal", () => {
    assert.equal(compare("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  });

  test("the full npm docs precedence chain", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      assert.equal(compare(chain[i], chain[i + 1]), -1, `${chain[i]} < ${chain[i + 1]}`);
    }
  });

  test("build metadata is ignored", () => {
    assert.equal(compare("1.0.0+build1", "1.0.0+build2"), 0);
  });

  test("gt/lt/eq helpers", () => {
    assert.equal(gt("1.2.3", "1.2.2"), true);
    assert.equal(gt("1.2.2", "1.2.3"), false);
    assert.equal(lt("1.2.2", "1.2.3"), true);
    assert.equal(eq("1.2.3", "1.2.3"), true);
  });
});

describe("satisfies: exact and comparator ranges", () => {
  test("exact version matches only itself", () => {
    assert.equal(satisfies("1.2.3", "1.2.3"), true);
    assert.equal(satisfies("1.2.4", "1.2.3"), false);
  });

  test("single comparator operators", () => {
    assert.equal(satisfies("1.2.3", ">=1.2.3"), true);
    assert.equal(satisfies("1.2.2", ">=1.2.3"), false);
    assert.equal(satisfies("1.2.3", ">1.2.3"), false);
    assert.equal(satisfies("1.2.4", ">1.2.3"), true);
    assert.equal(satisfies("1.2.3", "<=1.2.3"), true);
    assert.equal(satisfies("1.2.4", "<1.2.4"), false);
    assert.equal(satisfies("1.2.3", "=1.2.3"), true);
  });

  test("space-joined comparators are ANDed", () => {
    assert.equal(satisfies("1.2.7", ">=1.2.7 <1.3.0"), true);
    assert.equal(satisfies("1.2.9", ">=1.2.7 <1.3.0"), true);
    assert.equal(satisfies("1.3.0", ">=1.2.7 <1.3.0"), false);
    assert.equal(satisfies("1.2.6", ">=1.2.7 <1.3.0"), false);
  });

  test("|| joins comparator sets as OR", () => {
    const range = "1.2.7 || >=1.2.9 <2.0.0";
    assert.equal(satisfies("1.2.7", range), true);
    assert.equal(satisfies("1.2.8", range), false);
    assert.equal(satisfies("1.2.9", range), true);
    assert.equal(satisfies("1.4.6", range), true);
    assert.equal(satisfies("2.0.0", range), false);
  });
});

describe("satisfies: caret ranges (npm docs examples)", () => {
  test("^1.2.3 := >=1.2.3 <2.0.0", () => {
    assert.equal(satisfies("1.2.3", "^1.2.3"), true);
    assert.equal(satisfies("1.2.4", "^1.2.3"), true);
    assert.equal(satisfies("1.9.9", "^1.2.3"), true);
    assert.equal(satisfies("1.2.2", "^1.2.3"), false);
    assert.equal(satisfies("2.0.0", "^1.2.3"), false);
  });

  test("^0.2.3 := >=0.2.3 <0.3.0", () => {
    assert.equal(satisfies("0.2.3", "^0.2.3"), true);
    assert.equal(satisfies("0.2.9", "^0.2.3"), true);
    assert.equal(satisfies("0.3.0", "^0.2.3"), false);
    assert.equal(satisfies("0.2.2", "^0.2.3"), false);
  });

  test("^0.0.3 := >=0.0.3 <0.0.4", () => {
    assert.equal(satisfies("0.0.3", "^0.0.3"), true);
    assert.equal(satisfies("0.0.4", "^0.0.3"), false);
  });

  test("^1.2.x := >=1.2.0 <2.0.0", () => {
    assert.equal(satisfies("1.2.0", "^1.2.x"), true);
    assert.equal(satisfies("1.9.0", "^1.2.x"), true);
    assert.equal(satisfies("2.0.0", "^1.2.x"), false);
  });

  test("^0.0.x := >=0.0.0 <0.1.0", () => {
    assert.equal(satisfies("0.0.0", "^0.0.x"), true);
    assert.equal(satisfies("0.0.9", "^0.0.x"), true);
    assert.equal(satisfies("0.1.0", "^0.0.x"), false);
  });

  test("^0.0 := >=0.0.0 <0.1.0", () => {
    assert.equal(satisfies("0.0.5", "^0.0"), true);
    assert.equal(satisfies("0.1.0", "^0.0"), false);
  });

  test("^1.x := >=1.0.0 <2.0.0", () => {
    assert.equal(satisfies("1.0.0", "^1.x"), true);
    assert.equal(satisfies("1.9.9", "^1.x"), true);
    assert.equal(satisfies("2.0.0", "^1.x"), false);
  });

  test("^0.x := >=0.0.0 <1.0.0", () => {
    assert.equal(satisfies("0.0.0", "^0.x"), true);
    assert.equal(satisfies("0.9.9", "^0.x"), true);
    assert.equal(satisfies("1.0.0", "^0.x"), false);
  });
});

describe("satisfies: tilde ranges (npm docs examples)", () => {
  test("~1.2.3 := >=1.2.3 <1.3.0", () => {
    assert.equal(satisfies("1.2.3", "~1.2.3"), true);
    assert.equal(satisfies("1.2.9", "~1.2.3"), true);
    assert.equal(satisfies("1.3.0", "~1.2.3"), false);
  });

  test("~1.2 := >=1.2.0 <1.3.0 (same as 1.2.x)", () => {
    assert.equal(satisfies("1.2.0", "~1.2"), true);
    assert.equal(satisfies("1.3.0", "~1.2"), false);
  });

  test("~1 := >=1.0.0 <2.0.0 (same as 1.x)", () => {
    assert.equal(satisfies("1.5.0", "~1"), true);
    assert.equal(satisfies("2.0.0", "~1"), false);
  });

  test("~0.2.3 := >=0.2.3 <0.3.0", () => {
    assert.equal(satisfies("0.2.5", "~0.2.3"), true);
    assert.equal(satisfies("0.3.0", "~0.2.3"), false);
  });

  test("~0.2 := >=0.2.0 <0.3.0", () => {
    assert.equal(satisfies("0.2.9", "~0.2"), true);
    assert.equal(satisfies("0.3.0", "~0.2"), false);
  });

  test("~0 := >=0.0.0 <1.0.0", () => {
    assert.equal(satisfies("0.9.9", "~0"), true);
    assert.equal(satisfies("1.0.0", "~0"), false);
  });

  test("~1.2.3-beta.2 := >=1.2.3-beta.2 <1.3.0", () => {
    assert.equal(satisfies("1.2.3-beta.2", "~1.2.3-beta.2"), true);
    assert.equal(satisfies("1.2.3-beta.4", "~1.2.3-beta.2"), true);
    assert.equal(satisfies("1.2.4", "~1.2.3-beta.2"), true);
    assert.equal(satisfies("1.2.3-beta.1", "~1.2.3-beta.2"), false);
  });
});

describe("satisfies: x-ranges (npm docs examples)", () => {
  test("* matches any release version", () => {
    assert.equal(satisfies("0.0.0", "*"), true);
    assert.equal(satisfies("99.9.9", "*"), true);
  });

  test("empty string range behaves like *", () => {
    assert.equal(satisfies("1.2.3", ""), true);
  });

  test("1.x := >=1.0.0 <2.0.0", () => {
    assert.equal(satisfies("1.0.0", "1.x"), true);
    assert.equal(satisfies("1.9.9", "1.x"), true);
    assert.equal(satisfies("2.0.0", "1.x"), false);
  });

  test("1.2.x := >=1.2.0 <1.3.0", () => {
    assert.equal(satisfies("1.2.0", "1.2.x"), true);
    assert.equal(satisfies("1.2.9", "1.2.x"), true);
    assert.equal(satisfies("1.3.0", "1.2.x"), false);
  });

  test("1.2.* behaves the same as 1.2.x", () => {
    assert.equal(satisfies("1.2.5", "1.2.*"), true);
    assert.equal(satisfies("1.3.0", "1.2.*"), false);
  });

  test("bare 1 is the same as 1.x", () => {
    assert.equal(satisfies("1.5.5", "1"), true);
    assert.equal(satisfies("2.0.0", "1"), false);
  });

  test("bare 1.2 is the same as 1.2.x", () => {
    assert.equal(satisfies("1.2.5", "1.2"), true);
    assert.equal(satisfies("1.3.0", "1.2"), false);
  });
});

describe("satisfies: hyphen ranges (npm docs examples)", () => {
  test("1.2.3 - 2.3.4 := >=1.2.3 <=2.3.4", () => {
    assert.equal(satisfies("1.2.3", "1.2.3 - 2.3.4"), true);
    assert.equal(satisfies("2.3.4", "1.2.3 - 2.3.4"), true);
    assert.equal(satisfies("2.3.5", "1.2.3 - 2.3.4"), false);
    assert.equal(satisfies("1.2.2", "1.2.3 - 2.3.4"), false);
  });

  test("1.2 - 2.3.4 := >=1.2.0 <=2.3.4", () => {
    assert.equal(satisfies("1.2.0", "1.2 - 2.3.4"), true);
    assert.equal(satisfies("1.1.9", "1.2 - 2.3.4"), false);
  });

  test("1.2.3 - 2.3 := >=1.2.3 <2.4.0", () => {
    assert.equal(satisfies("2.3.9", "1.2.3 - 2.3"), true);
    assert.equal(satisfies("2.4.0", "1.2.3 - 2.3"), false);
  });

  test("1.2.3 - 2 := >=1.2.3 <3.0.0", () => {
    assert.equal(satisfies("2.9.9", "1.2.3 - 2"), true);
    assert.equal(satisfies("3.0.0", "1.2.3 - 2"), false);
  });
});

describe("satisfies: prerelease rules", () => {
  test("a prerelease only satisfies a range that mentions a prerelease on the same major.minor.patch", () => {
    assert.equal(satisfies("1.2.3-alpha", "^1.2.3"), false); // ^1.2.3 mentions 1.2.3 (no prerelease) and 2.0.0-0
    assert.equal(satisfies("1.2.4-beta", "^1.2.3"), false); // tuple 1.2.4 never mentioned
    assert.equal(satisfies("1.2.3-beta", "^1.2.3-beta"), true); // lower bound shares the tuple and has a prerelease
  });

  test("comparator range with explicit prerelease bounds on the same tuple", () => {
    assert.equal(satisfies("1.2.3-alpha.7", ">1.2.3-alpha.3 <1.2.3-alpha.10"), true);
    assert.equal(satisfies("1.2.3-alpha.2", ">1.2.3-alpha.3 <1.2.3-alpha.10"), false);
  });

  test("* never matches a prerelease version", () => {
    assert.equal(satisfies("1.0.0-beta", "*"), false);
  });

  test("an x-range never matches a prerelease version", () => {
    assert.equal(satisfies("1.2.0-beta", "1.2.x"), false);
  });

  test("an exact prerelease version satisfies only itself", () => {
    assert.equal(satisfies("1.2.3-beta.1", "1.2.3-beta.1"), true);
    assert.equal(satisfies("1.2.3-beta.2", "1.2.3-beta.1"), false);
  });
});

describe("satisfies: invalid input", () => {
  test("an invalid version never satisfies anything", () => {
    assert.equal(satisfies("not-a-version", "^1.0.0"), false);
  });

  test("an invalid range is never satisfied", () => {
    assert.equal(satisfies("1.0.0", "not>>a range"), false);
  });
});

describe("maxSatisfying", () => {
  test("picks the highest version satisfying the range", () => {
    const versions = ["1.0.0", "1.2.0", "1.2.7", "1.3.0", "2.0.0"];
    assert.equal(maxSatisfying(versions, "^1.2.0"), "1.3.0"); // ^1.2.0 := >=1.2.0 <2.0.0
    assert.equal(maxSatisfying(versions, "~1.2.0"), "1.2.7"); // ~1.2.0 := >=1.2.0 <1.3.0
    assert.equal(maxSatisfying(versions, "^1"), "1.3.0");
    assert.equal(maxSatisfying(versions, "*"), "2.0.0");
  });

  test("returns null when nothing satisfies", () => {
    assert.equal(maxSatisfying(["1.0.0", "1.1.0"], "^2.0.0"), null);
  });

  test("skips invalid version strings", () => {
    assert.equal(maxSatisfying(["1.0.0", "garbage", "1.5.0"], "*"), "1.5.0");
  });

  test("excludes prereleases unless the range explicitly allows them", () => {
    const versions = ["1.2.3", "1.3.0-beta.1"];
    assert.equal(maxSatisfying(versions, "^1.2.0"), "1.2.3");
    assert.equal(maxSatisfying(versions, "^1.3.0-beta.1"), "1.3.0-beta.1");
  });
});
