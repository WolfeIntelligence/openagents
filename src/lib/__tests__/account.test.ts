import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deletionPlan, deletionPlanMessage, shapeAccountExport } from "../account";
import type { DeletionCandidatePackage, DeletionCandidateSubscription } from "../account";

const USER = { handle: "zach" };

describe("deletionPlan", () => {
  test("no owned packages, no subscriptions: hard delete, nothing to keep", () => {
    const plan = deletionPlan(USER, [], []);
    assert.deepEqual(plan, { ok: true, anonymize: false, packagesToDelete: [] });
  });

  test("owned packages with zero purchases: all deleted outright, no anonymize", () => {
    const owned: DeletionCandidatePackage[] = [
      { owner: "zach", name: "a", status: "live", hasPurchases: false },
      { owner: "zach", name: "b", status: "pending", hasPurchases: false },
    ];
    const plan = deletionPlan(USER, owned, []);
    assert.deepEqual(plan, {
      ok: true,
      anonymize: false,
      packagesToDelete: ["zach/a", "zach/b"],
    });
  });

  test("a purchased package that's still live blocks deletion, listing exactly that package", () => {
    const owned: DeletionCandidatePackage[] = [
      { owner: "zach", name: "a", status: "live", hasPurchases: true },
      { owner: "zach", name: "b", status: "unlisted", hasPurchases: false },
    ];
    const plan = deletionPlan(USER, owned, []);
    assert.deepEqual(plan, { ok: false, status: 409, reason: "unlist-first", packages: ["zach/a"] });
  });

  test("a purchased package that's deprecated (still publicly listed) also blocks deletion", () => {
    const owned: DeletionCandidatePackage[] = [
      { owner: "zach", name: "a", status: "deprecated", hasPurchases: true },
    ];
    const plan = deletionPlan(USER, owned, []);
    assert.equal(plan.ok, false);
  });

  test("a purchased package that's already unlisted allows deletion, anonymizing instead of hard-deleting", () => {
    const owned: DeletionCandidatePackage[] = [
      { owner: "zach", name: "a", status: "unlisted", hasPurchases: true },
      { owner: "zach", name: "b", status: "live", hasPurchases: false },
    ];
    const plan = deletionPlan(USER, owned, []);
    assert.deepEqual(plan, { ok: true, anonymize: true, packagesToDelete: ["zach/b"] });
  });

  test("an active subscription blocks deletion regardless of owned packages", () => {
    const subs: DeletionCandidateSubscription[] = [
      { purchaseId: "sub-1", expiresAt: new Date(Date.now() + 86_400_000) },
    ];
    const plan = deletionPlan(USER, [], subs);
    assert.deepEqual(plan, { ok: false, status: 409, reason: "active-subscription", purchaseIds: ["sub-1"] });
  });

  test("a lapsed (expired) subscription does not block deletion", () => {
    const subs: DeletionCandidateSubscription[] = [
      { purchaseId: "sub-1", expiresAt: new Date(Date.now() - 86_400_000) },
    ];
    const plan = deletionPlan(USER, [], subs);
    assert.equal(plan.ok, true);
  });

  test("a subscription purchase with no expiresAt (never granted access) does not block deletion", () => {
    const subs: DeletionCandidateSubscription[] = [{ purchaseId: "sub-1", expiresAt: null }];
    const plan = deletionPlan(USER, [], subs);
    assert.equal(plan.ok, true);
  });

  test("an active subscription is checked before the unlist-first gate", () => {
    const owned: DeletionCandidatePackage[] = [{ owner: "zach", name: "a", status: "live", hasPurchases: true }];
    const subs: DeletionCandidateSubscription[] = [
      { purchaseId: "sub-1", expiresAt: new Date(Date.now() + 86_400_000) },
    ];
    const plan = deletionPlan(USER, owned, subs);
    assert.equal(plan.ok, false);
    assert.equal((plan as { reason: string }).reason, "active-subscription");
  });

  test("multiple still-listed purchased packages are all listed in the refusal", () => {
    const owned: DeletionCandidatePackage[] = [
      { owner: "zach", name: "a", status: "live", hasPurchases: true },
      { owner: "zach", name: "b", status: "pending", hasPurchases: true },
      { owner: "zach", name: "c", status: "unlisted", hasPurchases: true },
    ];
    const plan = deletionPlan(USER, owned, []);
    assert.equal(plan.ok, false);
    assert.deepEqual((plan as { packages: string[] }).packages, ["zach/a", "zach/b"]);
  });
});

describe("deletionPlanMessage", () => {
  test("active-subscription reason mentions the billing portal", () => {
    const msg = deletionPlanMessage({ ok: false, status: 409, reason: "active-subscription", purchaseIds: ["p1"] });
    assert.match(msg, /billing portal/);
  });

  test("unlist-first reason names the blocking packages", () => {
    const msg = deletionPlanMessage({ ok: false, status: 409, reason: "unlist-first", packages: ["zach/a", "zach/b"] });
    assert.match(msg, /zach\/a/);
    assert.match(msg, /zach\/b/);
  });
});

describe("shapeAccountExport", () => {
  test("shapes every section, dates as ISO strings, packages as owner/name ids", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const exported = shapeAccountExport(
      { id: "u1", handle: "zach", name: "Zach", email: "zach@example.com", createdAt: now },
      [{ owner: "zach", name: "pkg-a" }],
      [
        {
          id: "purchase-1",
          owner: "openagents",
          name: "pr-reviewer",
          amountCents: 500,
          currency: "usd",
          status: "paid",
          receiptUrl: null,
          createdAt: now,
        },
      ],
      [{ owner: "openagents", name: "pr-reviewer", createdAt: now }],
      [{ owner: "openagents", name: "pr-reviewer", rating: 5, body: "great", createdAt: now, updatedAt: now }],
      [{ id: "token-1", name: "laptop", prefix: "abcd1234", createdAt: now }]
    );

    assert.deepEqual(exported.user, {
      id: "u1",
      handle: "zach",
      name: "Zach",
      email: "zach@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(exported.packages, ["zach/pkg-a"]);
    assert.equal(exported.purchases.length, 1);
    assert.equal(exported.purchases[0].createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(exported.stars.length, 1);
    assert.equal(exported.reviews.length, 1);
    assert.equal(exported.tokens.length, 1);
    // Token secrets are never part of this shape at all — only id/name/prefix/createdAt.
    assert.deepEqual(Object.keys(exported.tokens[0]).sort(), ["createdAt", "id", "name", "prefix"]);
  });

  test("empty account: every section is an empty array, never undefined/null", () => {
    const now = new Date();
    const exported = shapeAccountExport(
      { id: "u1", handle: null, name: null, email: null, createdAt: now },
      [],
      [],
      [],
      [],
      []
    );
    assert.deepEqual(exported.packages, []);
    assert.deepEqual(exported.purchases, []);
    assert.deepEqual(exported.stars, []);
    assert.deepEqual(exported.reviews, []);
    assert.deepEqual(exported.tokens, []);
  });
});
