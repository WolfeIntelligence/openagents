// Run via `npm test` (node --import tsx --test) or `npx tsx --test <this file>`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCatalogQuery } from "../catalog";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../types";

function params(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

describe("parseCatalogQuery — limit", () => {
  test("defaults to DEFAULT_PAGE_SIZE when absent", () => {
    const query = parseCatalogQuery(params({}));
    assert.equal(query.limit, DEFAULT_PAGE_SIZE);
  });

  test("accepts a valid limit within range", () => {
    const query = parseCatalogQuery(params({ limit: "10" }));
    assert.equal(query.limit, 10);
  });

  test("clamps a limit above MAX_PAGE_SIZE", () => {
    const query = parseCatalogQuery(params({ limit: "99999" }));
    assert.equal(query.limit, MAX_PAGE_SIZE);
  });

  test("clamps a zero or negative limit up to 1", () => {
    assert.equal(parseCatalogQuery(params({ limit: "0" })).limit, 1);
    assert.equal(parseCatalogQuery(params({ limit: "-5" })).limit, 1);
  });

  test("falls back to the default for a non-numeric limit", () => {
    const query = parseCatalogQuery(params({ limit: "banana" }));
    assert.equal(query.limit, DEFAULT_PAGE_SIZE);
  });

  test("floors a fractional limit", () => {
    const query = parseCatalogQuery(params({ limit: "5.9" }));
    assert.equal(query.limit, 5);
  });
});

describe("parseCatalogQuery — offset", () => {
  test("is left unset (callers default to 0) when absent", () => {
    const query = parseCatalogQuery(params({}));
    assert.equal(query.offset, undefined);
  });

  test("accepts a valid non-negative offset", () => {
    assert.equal(parseCatalogQuery(params({ offset: "50" })).offset, 50);
    assert.equal(parseCatalogQuery(params({ offset: "0" })).offset, 0);
  });

  test("drops a negative or non-numeric offset", () => {
    assert.equal(parseCatalogQuery(params({ offset: "-1" })).offset, undefined);
    assert.equal(parseCatalogQuery(params({ offset: "nope" })).offset, undefined);
  });
});

describe("parseCatalogQuery — enums", () => {
  test("drops an invalid kind/runtime/sort rather than throwing", () => {
    const query = parseCatalogQuery(params({ kind: "not-a-kind", runtime: "not-a-runtime", sort: "not-a-sort" }));
    assert.equal(query.kind, undefined);
    assert.equal(query.runtime, undefined);
    assert.equal(query.sort, undefined);
  });

  test("keeps a valid kind/runtime/sort", () => {
    const query = parseCatalogQuery(params({ kind: "skill", runtime: "cursor", sort: "downloads" }));
    assert.equal(query.kind, "skill");
    assert.equal(query.runtime, "cursor");
    assert.equal(query.sort, "downloads");
  });

  test("price accepts only free/paid", () => {
    assert.equal(parseCatalogQuery(params({ price: "free" })).price, "free");
    assert.equal(parseCatalogQuery(params({ price: "paid" })).price, "paid");
    assert.equal(parseCatalogQuery(params({ price: "bogus" })).price, undefined);
  });
});

describe("parseCatalogQuery — q/tag/owner", () => {
  test("keeps a non-empty q/tag/owner", () => {
    const query = parseCatalogQuery(params({ q: "code review", tag: "testing", owner: "openagents" }));
    assert.equal(query.q, "code review");
    assert.equal(query.tag, "testing");
    assert.equal(query.owner, "openagents");
  });

  test("drops an empty q/tag/owner", () => {
    const query = parseCatalogQuery(params({ q: "", tag: "", owner: "" }));
    assert.equal(query.q, undefined);
    assert.equal(query.tag, undefined);
    assert.equal(query.owner, undefined);
  });

  test("also accepts a plain Record (Next.js searchParams shape), taking the first value of an array", () => {
    const query = parseCatalogQuery({ q: ["first", "second"], limit: "5" });
    assert.equal(query.q, "first");
    assert.equal(query.limit, 5);
  });
});
