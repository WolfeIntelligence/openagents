// Pure-logic unit tests for `../rollups` — no Next.js/DB imports, so this runs
// under plain Node instead of the Next test/build pipeline.
//
// Run with:
//   npx tsx --test src/lib/__tests__/rollups.test.ts
// or, if `tsx`'s `--test` integration isn't available in this Node version:
//   node --import tsx --test src/lib/__tests__/rollups.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { aggregateEvents, type RawDownloadEvent } from "../rollups";

test("groups events by (owner, name, day) and counts them", () => {
  const events: RawDownloadEvent[] = [
    { owner: "acme", name: "widget", day: "2026-01-01", version: "1.0.0", runtime: "node" },
    { owner: "acme", name: "widget", day: "2026-01-01", version: "1.0.0", runtime: "node" },
    { owner: "acme", name: "widget", day: "2026-01-02", version: "1.0.0", runtime: "node" },
    { owner: "acme", name: "gadget", day: "2026-01-01", version: "2.0.0", runtime: "python" },
  ];

  const result = aggregateEvents(events);
  assert.equal(result.length, 3);

  const widgetDay1 = result.find((r) => r.owner === "acme" && r.name === "widget" && r.day === "2026-01-01");
  assert.ok(widgetDay1);
  assert.equal(widgetDay1!.count, 2);

  const widgetDay2 = result.find((r) => r.owner === "acme" && r.name === "widget" && r.day === "2026-01-02");
  assert.ok(widgetDay2);
  assert.equal(widgetDay2!.count, 1);

  const gadgetDay1 = result.find((r) => r.owner === "acme" && r.name === "gadget" && r.day === "2026-01-01");
  assert.ok(gadgetDay1);
  assert.equal(gadgetDay1!.count, 1);
});

test("tallies byVersion and byRuntime breakdowns", () => {
  const events: RawDownloadEvent[] = [
    { owner: "acme", name: "widget", day: "2026-01-01", version: "1.0.0", runtime: "node" },
    { owner: "acme", name: "widget", day: "2026-01-01", version: "1.0.0", runtime: "python" },
    { owner: "acme", name: "widget", day: "2026-01-01", version: "1.1.0", runtime: "node" },
  ];

  const [rollup] = aggregateEvents(events);
  assert.equal(rollup.count, 3);
  assert.deepEqual(rollup.byVersion, { "1.0.0": 2, "1.1.0": 1 });
  assert.deepEqual(rollup.byRuntime, { node: 2, python: 1 });
});

test("a null or missing runtime folds into 'unknown'", () => {
  const events: RawDownloadEvent[] = [
    { owner: "acme", name: "widget", day: "2026-01-01", version: "1.0.0", runtime: null },
    { owner: "acme", name: "widget", day: "2026-01-01", version: "1.0.0" },
  ];

  const [rollup] = aggregateEvents(events);
  assert.deepEqual(rollup.byRuntime, { unknown: 2 });
});

test("empty input yields an empty result", () => {
  assert.deepEqual(aggregateEvents([]), []);
});

test("distinguishes owner/name pairs that could collide if naively concatenated", () => {
  // Regression guard for a delimiter-less key like `${owner}${name}${day}`,
  // which would conflate ("a", "bc") with ("ab", "c").
  const events: RawDownloadEvent[] = [
    { owner: "a", name: "bc", day: "2026-01-01", version: "1.0.0" },
    { owner: "ab", name: "c", day: "2026-01-01", version: "1.0.0" },
  ];

  const result = aggregateEvents(events);
  assert.equal(result.length, 2);
  for (const r of result) assert.equal(r.count, 1);
});
