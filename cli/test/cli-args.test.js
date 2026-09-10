import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, checkUnknownOptions, closestOption } from "../bin/openagents.js";

describe("parseArgs (B13a)", () => {
  test("--version as an option (not the command) captures its value", () => {
    // Simulates `openagents init --version 2.3.1`: bin/openagents.js strips
    // the command itself before calling parseArgs on the rest.
    const args = parseArgs(["--version", "2.3.1", "--kind", "workflow"]);
    assert.equal(args.version, "2.3.1");
    assert.equal(args.kind, "workflow");
  });

  test("--version=2.3.1 form also works", () => {
    const args = parseArgs(["--version=2.3.1"]);
    assert.equal(args.version, "2.3.1");
  });

  test("a bare trailing --version (no value) is treated as a boolean flag", () => {
    const args = parseArgs(["--version"]);
    assert.equal(args.version, true);
  });

  test("-h/--help still set the help flag", () => {
    assert.equal(parseArgs(["-h"]).help, true);
    assert.equal(parseArgs(["--help"]).help, true);
  });

  test("positional args land in _", () => {
    const args = parseArgs(["openagents/pr-reviewer", "--runtime", "claude-code"]);
    assert.deepEqual(args._, ["openagents/pr-reviewer"]);
    assert.equal(args.runtime, "claude-code");
  });
});

describe("checkUnknownOptions (B13a/B13d)", () => {
  test("flags a typo'd option and suggests the closest known one", () => {
    const msg = checkUnknownOptions("add", { _: [], runtim: "claude-code" });
    assert.equal(msg, "unknown option --runtim (did you mean --runtime?)");
  });

  test("accepts every documented option for add", () => {
    const msg = checkUnknownOptions("add", { _: [], runtime: "x", registry: "y", dir: "z" });
    assert.equal(msg, null);
  });

  test("commands with no options (validate) reject any flag", () => {
    const msg = checkUnknownOptions("validate", { _: [], bogus: true });
    assert.equal(msg, "unknown option --bogus");
  });

  test("_ and help are never flagged as unknown", () => {
    const msg = checkUnknownOptions("add", { _: ["x"], help: true });
    assert.equal(msg, null);
  });
});

describe("closestOption", () => {
  test("finds a near match", () => {
    assert.equal(closestOption("runtim", ["runtime", "registry", "dir"]), "runtime");
  });

  test("returns null when nothing is close", () => {
    assert.equal(closestOption("zzzzzzzzzz", ["runtime", "registry", "dir"]), null);
  });
});
