import { test } from "node:test";
import assert from "node:assert/strict";
import { isHandleTaken, isReservedHandle, RESERVED_HANDLES, seedOwners } from "../reserved";

test("RESERVED_HANDLES: contains the documented static set", () => {
  const expected = [
    "admin",
    "administrator",
    "api",
    "app",
    "auth",
    "docs",
    "explore",
    "help",
    "login",
    "logout",
    "me",
    "null",
    "openagents",
    // G-P3: /org/<handle> organization pages.
    "org",
    "p",
    "pricing",
    "publish",
    "purchases",
    "root",
    "settings",
    "signin",
    "signout",
    "support",
    "system",
    "u",
    "undefined",
    "user",
    "users",
    "www",
  ];
  for (const handle of expected) {
    assert.ok(RESERVED_HANDLES.has(handle), `expected RESERVED_HANDLES to contain "${handle}"`);
  }
  assert.equal(RESERVED_HANDLES.size, expected.length);
});

test("isReservedHandle: matches the static set case-insensitively", () => {
  assert.equal(isReservedHandle("admin"), true);
  assert.equal(isReservedHandle("Admin"), true);
  assert.equal(isReservedHandle("ADMIN"), true);
  assert.equal(isReservedHandle("publish"), true);
});

test("isReservedHandle: an ordinary handle is not reserved", () => {
  assert.equal(isReservedHandle("zwolfe42"), false);
  assert.equal(isReservedHandle("some-random-creator"), false);
});

test("seedOwners: never throws, returns an array (empty when catalog/ is absent from cwd)", () => {
  assert.doesNotThrow(() => seedOwners());
  assert.ok(Array.isArray(seedOwners()));
});

test("isReservedHandle: reserves every seed catalog owner directory", () => {
  for (const owner of seedOwners()) {
    assert.equal(isReservedHandle(owner), true, `expected seed owner "${owner}" to be reserved`);
  }
});

test("isHandleTaken: false with no database configured (zero-env default)", async () => {
  // This suite never sets DATABASE_URL, so isHandleTaken must degrade to
  // "nothing to collide with" rather than throw — same convention as every
  // other DB-backed export in this codebase.
  assert.equal(await isHandleTaken("zwolfe42"), false);
  assert.equal(await isHandleTaken("some-org"), false);
});
