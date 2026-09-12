import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidRating,
  isValidReviewBody,
  computeAverage,
  clampReviewsLimit,
  clampReviewsOffset,
  normalizeReviewSort,
  reviewsHasMore,
  buildRatingHistogram,
  MAX_REVIEW_BODY_LENGTH,
  DEFAULT_REVIEWS_PAGE_SIZE,
  MAX_REVIEWS_PAGE_SIZE,
} from "../reviews";
import { isValidHandleFormat, isValidBio, isValidWebsite, MAX_BIO_LENGTH } from "../profile";

// ---------------------------------------------------------------------------
// Rating validation
// ---------------------------------------------------------------------------

test("isValidRating: accepts whole numbers 1 through 5", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    assert.equal(isValidRating(n), true, `expected ${n} to be valid`);
  }
});

test("isValidRating: rejects out-of-range, fractional, and non-number values", () => {
  assert.equal(isValidRating(0), false);
  assert.equal(isValidRating(6), false);
  assert.equal(isValidRating(-1), false);
  assert.equal(isValidRating(3.5), false);
  assert.equal(isValidRating("3"), false);
  assert.equal(isValidRating(null), false);
  assert.equal(isValidRating(undefined), false);
  assert.equal(isValidRating(NaN), false);
});

// ---------------------------------------------------------------------------
// Review body validation
// ---------------------------------------------------------------------------

test("isValidReviewBody: undefined/null is valid (body is optional)", () => {
  assert.equal(isValidReviewBody(undefined), true);
  assert.equal(isValidReviewBody(null), true);
});

test("isValidReviewBody: accepts strings up to the length cap", () => {
  assert.equal(isValidReviewBody(""), true);
  assert.equal(isValidReviewBody("great package"), true);
  assert.equal(isValidReviewBody("a".repeat(MAX_REVIEW_BODY_LENGTH)), true);
});

test("isValidReviewBody: rejects strings over the cap and non-strings", () => {
  assert.equal(isValidReviewBody("a".repeat(MAX_REVIEW_BODY_LENGTH + 1)), false);
  assert.equal(isValidReviewBody(42), false);
});

// ---------------------------------------------------------------------------
// Average computation
// ---------------------------------------------------------------------------

test("computeAverage: mean of sum/count", () => {
  assert.equal(computeAverage(15, 3), 5);
  assert.equal(computeAverage(10, 4), 2.5);
  assert.equal(computeAverage(5, 1), 5);
});

test("computeAverage: undefined when count is zero, never NaN", () => {
  assert.equal(computeAverage(0, 0), undefined);
  assert.equal(computeAverage(100, 0), undefined);
});

// ---------------------------------------------------------------------------
// Pagination clamping
// ---------------------------------------------------------------------------

test("clampReviewsLimit: defaults when absent or not a finite number", () => {
  assert.equal(clampReviewsLimit(undefined), DEFAULT_REVIEWS_PAGE_SIZE);
  assert.equal(clampReviewsLimit("not-a-number"), DEFAULT_REVIEWS_PAGE_SIZE);
  assert.equal(clampReviewsLimit(NaN), DEFAULT_REVIEWS_PAGE_SIZE);
});

test("clampReviewsLimit: clamps into [1, MAX_REVIEWS_PAGE_SIZE]", () => {
  assert.equal(clampReviewsLimit(0), 1);
  assert.equal(clampReviewsLimit(-5), 1);
  assert.equal(clampReviewsLimit(MAX_REVIEWS_PAGE_SIZE + 50), MAX_REVIEWS_PAGE_SIZE);
  assert.equal(clampReviewsLimit(10), 10);
  assert.equal(clampReviewsLimit("25"), 25);
  assert.equal(clampReviewsLimit(10.9), 10);
});

test("clampReviewsOffset: defaults to 0 when absent, negative, or invalid", () => {
  assert.equal(clampReviewsOffset(undefined), 0);
  assert.equal(clampReviewsOffset(-1), 0);
  assert.equal(clampReviewsOffset("nope"), 0);
});

test("clampReviewsOffset: passes through valid non-negative integers", () => {
  assert.equal(clampReviewsOffset(20), 20);
  assert.equal(clampReviewsOffset("40"), 40);
  assert.equal(clampReviewsOffset(5.9), 5);
});

// ---------------------------------------------------------------------------
// Sort normalization (Z3)
// ---------------------------------------------------------------------------

test("normalizeReviewSort: passes through recognized values", () => {
  assert.equal(normalizeReviewSort("rating"), "rating");
  assert.equal(normalizeReviewSort("helpful"), "helpful");
  assert.equal(normalizeReviewSort("newest"), "newest");
});

test("normalizeReviewSort: defaults to newest for anything else", () => {
  assert.equal(normalizeReviewSort(undefined), "newest");
  assert.equal(normalizeReviewSort(null), "newest");
  assert.equal(normalizeReviewSort("bogus"), "newest");
  assert.equal(normalizeReviewSort(42), "newest");
});

// ---------------------------------------------------------------------------
// "Load more" pagination math (Z3)
// ---------------------------------------------------------------------------

test("reviewsHasMore: true when the page just fetched didn't reach the end", () => {
  assert.equal(reviewsHasMore(0, 20, 45), true);
  assert.equal(reviewsHasMore(20, 20, 45), true);
});

test("reviewsHasMore: false when the fetched page reaches or exceeds the total", () => {
  assert.equal(reviewsHasMore(40, 20, 45), false);
  assert.equal(reviewsHasMore(0, 20, 20), false);
  assert.equal(reviewsHasMore(0, 20, 0), false);
});

// ---------------------------------------------------------------------------
// Rating histogram (Z3)
// ---------------------------------------------------------------------------

test("buildRatingHistogram: counts each star rating, all five keys always present", () => {
  const histogram = buildRatingHistogram([5, 5, 4, 3, 3, 3, 1]);
  assert.deepEqual(histogram, { 1: 1, 2: 0, 3: 3, 4: 1, 5: 2 });
});

test("buildRatingHistogram: empty input is all zeros", () => {
  assert.deepEqual(buildRatingHistogram([]), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
});

test("buildRatingHistogram: ignores out-of-range or non-integer values", () => {
  const histogram = buildRatingHistogram([0, 6, 3.5, -1, 5]);
  assert.deepEqual(histogram, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
});

// ---------------------------------------------------------------------------
// Handle / bio / website validation (profile.ts)
// ---------------------------------------------------------------------------

test("isValidHandleFormat: accepts lowercase letters, digits, hyphens, 2-39 chars", () => {
  assert.equal(isValidHandleFormat("ab"), true);
  assert.equal(isValidHandleFormat("zach-wolfe"), true);
  assert.equal(isValidHandleFormat("agent007"), true);
  assert.equal(isValidHandleFormat("a".repeat(39)), true);
});

test("isValidHandleFormat: rejects bad shapes", () => {
  assert.equal(isValidHandleFormat("a"), false); // too short
  assert.equal(isValidHandleFormat("a".repeat(40)), false); // too long
  assert.equal(isValidHandleFormat("Zach"), false); // uppercase
  assert.equal(isValidHandleFormat("zach_wolfe"), false); // underscore
  assert.equal(isValidHandleFormat("zach wolfe"), false); // space
  assert.equal(isValidHandleFormat(""), false);
});

test("isValidBio: within the length cap, empty allowed", () => {
  assert.equal(isValidBio(""), true);
  assert.equal(isValidBio("a".repeat(MAX_BIO_LENGTH)), true);
  assert.equal(isValidBio("a".repeat(MAX_BIO_LENGTH + 1)), false);
});

test("isValidWebsite: empty string clears it", () => {
  assert.equal(isValidWebsite(""), true);
});

test("isValidWebsite: accepts https URLs, rejects http and garbage", () => {
  assert.equal(isValidWebsite("https://example.com"), true);
  assert.equal(isValidWebsite("http://example.com"), false);
  assert.equal(isValidWebsite("not a url"), false);
  assert.equal(isValidWebsite("ftp://example.com"), false);
});
