import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRemoveMember,
  canSetMemberRole,
  evaluateTransferEligibility,
  isSoleOwner,
  isValidOrgHandleFormat,
  isValidOrgRole,
  ORG_ROLES,
  type OrgMemberForRules,
} from "../orgs";

// ---------------------------------------------------------------------------
// Handle/role format
// ---------------------------------------------------------------------------

test("isValidOrgHandleFormat: 2-39 lowercase letters, digits, and hyphens", () => {
  assert.equal(isValidOrgHandleFormat("acme"), true);
  assert.equal(isValidOrgHandleFormat("acme-labs"), true);
  assert.equal(isValidOrgHandleFormat("a1"), true);
  assert.equal(isValidOrgHandleFormat("a"), false); // too short
  assert.equal(isValidOrgHandleFormat("a".repeat(40)), false); // too long
  assert.equal(isValidOrgHandleFormat("Acme"), false); // uppercase
  assert.equal(isValidOrgHandleFormat("acme_labs"), false); // underscore
  assert.equal(isValidOrgHandleFormat("acme labs"), false); // space
});

test("isValidOrgRole: accepts owner/admin/member, rejects junk", () => {
  assert.equal(isValidOrgRole("owner"), true);
  assert.equal(isValidOrgRole("admin"), true);
  assert.equal(isValidOrgRole("member"), true);
  assert.equal(isValidOrgRole("superadmin"), false);
  assert.equal(isValidOrgRole(""), false);
  assert.equal(ORG_ROLES.length, 3);
});

// ---------------------------------------------------------------------------
// Role transition rules (last owner)
// ---------------------------------------------------------------------------

const soleOwner: OrgMemberForRules[] = [
  { userId: "u1", role: "owner" },
  { userId: "u2", role: "member" },
];

const twoOwners: OrgMemberForRules[] = [
  { userId: "u1", role: "owner" },
  { userId: "u2", role: "owner" },
];

test("isSoleOwner: true only for the one owner when there's exactly one", () => {
  assert.equal(isSoleOwner(soleOwner, "u1"), true);
  assert.equal(isSoleOwner(soleOwner, "u2"), false);
  assert.equal(isSoleOwner(twoOwners, "u1"), false);
  assert.equal(isSoleOwner(twoOwners, "u2"), false);
});

test("canSetMemberRole: promoting to owner is always fine", () => {
  assert.equal(canSetMemberRole(soleOwner, "u2", "owner"), true);
  assert.equal(canSetMemberRole(soleOwner, "u1", "owner"), true);
});

test("canSetMemberRole: refuses to demote the sole owner", () => {
  assert.equal(canSetMemberRole(soleOwner, "u1", "admin"), false);
  assert.equal(canSetMemberRole(soleOwner, "u1", "member"), false);
});

test("canSetMemberRole: demoting one of several owners is fine", () => {
  assert.equal(canSetMemberRole(twoOwners, "u1", "admin"), true);
  assert.equal(canSetMemberRole(twoOwners, "u2", "member"), true);
});

test("canSetMemberRole: changing a non-owner's role is always fine", () => {
  assert.equal(canSetMemberRole(soleOwner, "u2", "admin"), true);
});

test("canRemoveMember: refuses to remove the sole owner, allows everyone else", () => {
  assert.equal(canRemoveMember(soleOwner, "u1"), false);
  assert.equal(canRemoveMember(soleOwner, "u2"), true);
  assert.equal(canRemoveMember(twoOwners, "u1"), true);
  assert.equal(canRemoveMember(twoOwners, "u2"), true);
});

// ---------------------------------------------------------------------------
// Transfer eligibility (pure)
// ---------------------------------------------------------------------------

test("evaluateTransferEligibility: seed packages can never be transferred", () => {
  const result = evaluateTransferEligibility({
    pkg: { owner: "acme", ownerType: "user", source: "seed" },
    callerIsPackageOwner: true,
    to: "acme-labs",
    callerHandle: "acme",
    destinationOrgExists: true,
    callerManagesDestinationOrg: true,
  });
  assert.deepEqual(result, { ok: false, status: 400, message: "seed packages can't be transferred" });
});

test("evaluateTransferEligibility: only the current owner may transfer", () => {
  const result = evaluateTransferEligibility({
    pkg: { owner: "acme", ownerType: "user", source: "db" },
    callerIsPackageOwner: false,
    to: "acme-labs",
    callerHandle: "someone-else",
    destinationOrgExists: true,
    callerManagesDestinationOrg: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
});

test("evaluateTransferEligibility: moving back to the caller's own handle is always allowed", () => {
  const result = evaluateTransferEligibility({
    pkg: { owner: "acme-labs", ownerType: "org", source: "db" },
    callerIsPackageOwner: true,
    to: "zach",
    callerHandle: "zach",
    destinationOrgExists: false, // irrelevant for the self case
    callerManagesDestinationOrg: false,
  });
  assert.deepEqual(result, { ok: true });
});

test("evaluateTransferEligibility: destination org must exist", () => {
  const result = evaluateTransferEligibility({
    pkg: { owner: "zach", ownerType: "user", source: "db" },
    callerIsPackageOwner: true,
    to: "nonexistent-org",
    callerHandle: "zach",
    destinationOrgExists: false,
    callerManagesDestinationOrg: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("evaluateTransferEligibility: caller must manage the destination org", () => {
  const result = evaluateTransferEligibility({
    pkg: { owner: "zach", ownerType: "user", source: "db" },
    callerIsPackageOwner: true,
    to: "acme-labs",
    callerHandle: "zach",
    destinationOrgExists: true,
    callerManagesDestinationOrg: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
});

test("evaluateTransferEligibility: owner transferring to an org they manage succeeds", () => {
  const result = evaluateTransferEligibility({
    pkg: { owner: "zach", ownerType: "user", source: "db" },
    callerIsPackageOwner: true,
    to: "acme-labs",
    callerHandle: "zach",
    destinationOrgExists: true,
    callerManagesDestinationOrg: true,
  });
  assert.deepEqual(result, { ok: true });
});

test("evaluateTransferEligibility: an org admin (not just owner) may transfer the org's package", () => {
  // callerIsPackageOwner is resolved by the caller (transferPackage) from org
  // membership role — this function just trusts the boolean, so this test
  // documents that admins are expected to pass `true` here too.
  const result = evaluateTransferEligibility({
    pkg: { owner: "acme-labs", ownerType: "org", source: "db" },
    callerIsPackageOwner: true,
    to: "another-org",
    callerHandle: "an-admin",
    destinationOrgExists: true,
    callerManagesDestinationOrg: true,
  });
  assert.deepEqual(result, { ok: true });
});
