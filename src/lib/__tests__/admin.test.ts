// Pure-logic unit test for `../admin`'s `adminHandleList`. `isAdmin` itself
// needs a database (or a real requester) and is exercised by hand, same
// convention as the rest of this test directory.
//
// Run with:
//   npx tsx --test src/lib/__tests__/admin.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { adminHandleList } from "../admin";

test("adminHandleList: trims, lowercases, drops blanks, keeps declared order", () => {
  assert.deepEqual(adminHandleList("Alice, bob ,, CARL"), ["alice", "bob", "carl"]);
  assert.deepEqual(adminHandleList("bob,alice"), ["bob", "alice"], "order is preserved, not sorted");
});

test("adminHandleList: empty for unset or blank input", () => {
  assert.deepEqual(adminHandleList(undefined), []);
  assert.deepEqual(adminHandleList(""), []);
  assert.deepEqual(adminHandleList("   ,  ,"), []);
});

test("adminHandleList: does not dedupe (a duplicate stays a duplicate)", () => {
  assert.deepEqual(adminHandleList("alice,alice"), ["alice", "alice"]);
});
