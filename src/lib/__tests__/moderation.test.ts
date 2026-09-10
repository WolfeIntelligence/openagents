import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isReviewRequired,
  isSettableStatus,
  isValidReplacementIdFormat,
  isValidReportReason,
  isValidStatusTransition,
  REPORT_REASONS,
  requiresAdminForTransition,
  SETTABLE_STATUSES,
} from "../moderation";
import { PACKAGE_STATUSES, type PackageStatus } from "../types";

test("isSettableStatus: accepts live/unlisted/deprecated, rejects pending and junk", () => {
  assert.equal(isSettableStatus("live"), true);
  assert.equal(isSettableStatus("unlisted"), true);
  assert.equal(isSettableStatus("deprecated"), true);
  assert.equal(isSettableStatus("pending"), false);
  assert.equal(isSettableStatus("banned"), false);
  assert.equal(isSettableStatus(""), false);
  assert.equal(SETTABLE_STATUSES.length, 3);
});

test("isValidStatusTransition: matches the documented transition table exactly", () => {
  const expected: Record<PackageStatus, PackageStatus[]> = {
    pending: ["live", "unlisted"],
    live: ["unlisted", "deprecated"],
    unlisted: ["live", "deprecated"],
    deprecated: ["live", "unlisted"],
  };

  for (const from of PACKAGE_STATUSES) {
    for (const to of PACKAGE_STATUSES) {
      const shouldBeValid = expected[from].includes(to);
      assert.equal(
        isValidStatusTransition(from, to),
        shouldBeValid,
        `${from} -> ${to} expected ${shouldBeValid}`
      );
    }
  }
});

test("isValidStatusTransition: never allows a no-op or a path back to pending", () => {
  for (const status of PACKAGE_STATUSES) {
    assert.equal(isValidStatusTransition(status, status), false, `${status} -> ${status}`);
  }
  for (const from of PACKAGE_STATUSES) {
    assert.equal(isValidStatusTransition(from, "pending"), false, `${from} -> pending`);
  }
});

test("requiresAdminForTransition: only gates pending -> live, and only when review is required", () => {
  assert.equal(requiresAdminForTransition("pending", "live", true), true);
  assert.equal(requiresAdminForTransition("pending", "live", false), false);
  assert.equal(requiresAdminForTransition("pending", "unlisted", true), false);
  assert.equal(requiresAdminForTransition("live", "unlisted", true), false);
  assert.equal(requiresAdminForTransition("unlisted", "live", true), false);
  assert.equal(requiresAdminForTransition("deprecated", "live", true), false);
});

test("isReviewRequired: presence-based on REQUIRE_REVIEW, like isDbEnabled", () => {
  const original = process.env.REQUIRE_REVIEW;
  try {
    delete process.env.REQUIRE_REVIEW;
    assert.equal(isReviewRequired(), false);
    process.env.REQUIRE_REVIEW = "1";
    assert.equal(isReviewRequired(), true);
    process.env.REQUIRE_REVIEW = "";
    assert.equal(isReviewRequired(), false);
  } finally {
    if (original === undefined) delete process.env.REQUIRE_REVIEW;
    else process.env.REQUIRE_REVIEW = original;
  }
});

test("REPORT_REASONS / isValidReportReason: matches the documented reason enum", () => {
  assert.deepEqual(REPORT_REASONS, ["prompt-injection", "malware", "license", "spam", "other"]);
  for (const reason of REPORT_REASONS) {
    assert.equal(isValidReportReason(reason), true);
  }
  assert.equal(isValidReportReason("other-thing"), false);
  assert.equal(isValidReportReason(""), false);
  assert.equal(isValidReportReason("MALWARE"), false);
});

test("isValidReplacementIdFormat: requires exactly one slash and two valid handle-shaped halves", () => {
  assert.equal(isValidReplacementIdFormat("openagents/pr-reviewer"), true);
  assert.equal(isValidReplacementIdFormat("zwolfe42/my-package"), true);
  assert.equal(isValidReplacementIdFormat("no-slash-here"), false);
  assert.equal(isValidReplacementIdFormat("too/many/slashes"), false);
  assert.equal(isValidReplacementIdFormat("/leading-slash"), false);
  assert.equal(isValidReplacementIdFormat("trailing-slash/"), false);
  assert.equal(isValidReplacementIdFormat("a/b"), false); // shorter than NAME_RE's 2-char minimum
  assert.equal(isValidReplacementIdFormat("Owner/Name"), false); // NAME_RE is lowercase-only
});
