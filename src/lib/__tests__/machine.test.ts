// Pure-logic unit tests for `../machine` (the OPENAGENTS_MACHINE_SECRET
// machine-publisher principal) and the scope/dispatch behavior it plugs into
// in `../requester`. The DB-backed export (`ensureMachinePrincipal`) needs a
// real Postgres connection and is exercised by hand against a dev database,
// not here — same convention as tokens.ts/orgs.ts (see their own test files'
// header comments). What's covered here instead:
//   - the bearer compare (right value accepted, wrong/short/unset refused)
//   - the machine principal's scope limits
//   - the owner restriction, down to the 403 it produces
//   - the lazy-org-creation ownership decision (chooseMachineOrgOwnerId)
//   - that an ordinary oa_ token is never mistaken for the machine secret
//
// Run with:
//   npx tsx --test src/lib/__tests__/machine.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseMachineOrgOwnerId,
  checkMachineOwner,
  MACHINE_HANDLE,
  MACHINE_OWNER_HANDLE,
  MACHINE_PRINCIPAL_LABEL,
  MACHINE_SCOPES,
  MIN_SECRET_LENGTH,
  verifyMachineSecret,
} from "../machine";
import { hasScope, type Requester } from "../requester";
import { TOKEN_SCOPES } from "../tokens";
import { isReservedHandle } from "../reserved";

// ---------------------------------------------------------------------------
// Bearer compare
// ---------------------------------------------------------------------------

test("verifyMachineSecret: accepts the exact configured secret", () => {
  const secret = "s3cret-value-that-is-at-least-32-chars";
  assert.equal(secret.length >= MIN_SECRET_LENGTH, true, "fixture secret must meet the length floor");
  assert.equal(verifyMachineSecret(secret, secret), true);
});

test("verifyMachineSecret: refuses a wrong value of the same length", () => {
  const secret = "s3cret-value-that-is-at-least-32-chars";
  const wrong = "x".repeat(secret.length);
  assert.equal(verifyMachineSecret(wrong, secret), false);
});

test("verifyMachineSecret: refuses a wrong value of a different length", () => {
  const secret = "s3cret-value-that-is-at-least-32-chars";
  assert.equal(verifyMachineSecret(secret.slice(0, -1), secret), false);
  assert.equal(verifyMachineSecret(secret + "x", secret), false);
});

test("verifyMachineSecret: refuses when the configured secret is shorter than the minimum", () => {
  const shortSecret = "a".repeat(MIN_SECRET_LENGTH - 1);
  assert.equal(verifyMachineSecret(shortSecret, shortSecret), false, "even an exact match is refused when too short");
});

test("verifyMachineSecret: refuses every candidate when the env var is unset", () => {
  assert.equal(verifyMachineSecret("anything", undefined), false);
  assert.equal(verifyMachineSecret("", undefined), false);
});

test("verifyMachineSecret: refuses an empty candidate even against a configured secret", () => {
  const secret = "s3cret-value-that-is-at-least-32-chars";
  assert.equal(verifyMachineSecret("", secret), false);
});

test("verifyMachineSecret: an ordinary oa_ token never matches, even with a secret configured", () => {
  // Proves the machine path can't accidentally intercept a real personal
  // access token — getRequester tries requesterFromMachineSecret first, and
  // this is exactly what makes falling through to requesterFromBearer safe.
  const secret = "s".repeat(40);
  const ordinaryToken = `oa_${"a".repeat(40)}`;
  assert.equal(verifyMachineSecret(ordinaryToken, secret), false);
});

test("verifyMachineSecret: defaults to reading OPENAGENTS_MACHINE_SECRET from the environment", () => {
  const saved = process.env.OPENAGENTS_MACHINE_SECRET;
  try {
    delete process.env.OPENAGENTS_MACHINE_SECRET;
    assert.equal(verifyMachineSecret("anything"), false);

    const secret = "s3cret-value-that-is-at-least-32-chars";
    process.env.OPENAGENTS_MACHINE_SECRET = secret;
    assert.equal(verifyMachineSecret(secret), true);
    assert.equal(verifyMachineSecret("nope-not-it"), false);
  } finally {
    if (saved === undefined) delete process.env.OPENAGENTS_MACHINE_SECRET;
    else process.env.OPENAGENTS_MACHINE_SECRET = saved;
  }
});

// ---------------------------------------------------------------------------
// Scope limits
// ---------------------------------------------------------------------------

test("MACHINE_SCOPES is exactly read, download, publish — no star, no review", () => {
  assert.deepEqual([...MACHINE_SCOPES].sort(), ["download", "publish", "read"]);
  assert.equal(MACHINE_SCOPES.includes("star" as never), false);
  assert.equal(MACHINE_SCOPES.includes("review" as never), false);
  // Every machine scope is a real token scope — the machine is a strict
  // subset of what a token can be granted, never something wider.
  for (const scope of MACHINE_SCOPES) {
    assert.equal((TOKEN_SCOPES as readonly string[]).includes(scope), true);
  }
});

test("hasScope: a machine requester is limited to MACHINE_SCOPES, same as a token", () => {
  const machine: Requester = { id: "m1", handle: MACHINE_HANDLE, via: "machine", scopes: [...MACHINE_SCOPES] };
  assert.equal(hasScope(machine, "read"), true);
  assert.equal(hasScope(machine, "download"), true);
  assert.equal(hasScope(machine, "publish"), true);
  assert.equal(hasScope(machine, "star"), false);
  assert.equal(hasScope(machine, "review"), false);
});

test("hasScope: a machine requester is not treated as unrestricted like a session", () => {
  // via "machine" must not hit hasScope's `via === "session"` shortcut —
  // otherwise it would silently gain every scope regardless of MACHINE_SCOPES.
  const machineWithNoScopes: Requester = { id: "m1", handle: MACHINE_HANDLE, via: "machine", scopes: [] };
  for (const scope of TOKEN_SCOPES) {
    assert.equal(hasScope(machineWithNoScopes, scope), false);
  }
});

// ---------------------------------------------------------------------------
// Owner restriction
// ---------------------------------------------------------------------------

test('checkMachineOwner: allows only "wolfe"', () => {
  assert.equal(MACHINE_OWNER_HANDLE, "wolfe");
  assert.deepEqual(checkMachineOwner("wolfe"), { ok: true });
});

test("checkMachineOwner: 403s any other owner, including the machine's own user handle", () => {
  for (const owner of ["acme", "wolfe-factory", "wolfe2", "Wolfe", ""]) {
    const result = checkMachineOwner(owner);
    assert.equal(result.ok, false, `expected ${JSON.stringify(owner)} to be rejected`);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.match(result.message, /wolfe/);
    }
  }
});

test("MACHINE_HANDLE and MACHINE_OWNER_HANDLE are both reserved, so a human can never claim them", () => {
  assert.equal(isReservedHandle(MACHINE_HANDLE), true);
  assert.equal(isReservedHandle(MACHINE_OWNER_HANDLE), true);
});

test("MACHINE_PRINCIPAL_LABEL identifies the principal without ever containing a secret", () => {
  assert.equal(MACHINE_PRINCIPAL_LABEL, "machine:wolfe-factory");
});

// ---------------------------------------------------------------------------
// Lazy org creation — ownership decision
// ---------------------------------------------------------------------------

test("chooseMachineOrgOwnerId: picks the first ADMIN_HANDLES entry that resolves to a real user", () => {
  const usersByHandle = new Map([["bob", "u2"]]); // "alice" doesn't exist yet
  assert.equal(chooseMachineOrgOwnerId(["alice", "bob"], usersByHandle, "u3"), "u2");
});

test("chooseMachineOrgOwnerId: ADMIN_HANDLES order matters — first match wins", () => {
  const usersByHandle = new Map([
    ["alice", "u1"],
    ["bob", "u2"],
  ]);
  assert.equal(chooseMachineOrgOwnerId(["alice", "bob"], usersByHandle, null), "u1");
  assert.equal(chooseMachineOrgOwnerId(["bob", "alice"], usersByHandle, null), "u2");
});

test("chooseMachineOrgOwnerId: falls back to the existing admin user when ADMIN_HANDLES is empty", () => {
  assert.equal(chooseMachineOrgOwnerId([], new Map(), "u3"), "u3");
});

test("chooseMachineOrgOwnerId: falls back to the existing admin user when no ADMIN_HANDLES entry resolves", () => {
  assert.equal(chooseMachineOrgOwnerId(["ghost"], new Map(), "u3"), "u3");
});

test("chooseMachineOrgOwnerId: null when nothing resolves — the org can't be created yet", () => {
  assert.equal(chooseMachineOrgOwnerId([], new Map(), null), null);
  assert.equal(chooseMachineOrgOwnerId(["ghost"], new Map(), null), null);
});
