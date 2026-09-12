// Pure-logic unit tests for `../search-client` — no Next.js/React/DOM
// imports, so this runs under plain Node instead of the Next test/build
// pipeline.
//
// Run with: npm test (== node scripts/run-tests.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldQuery,
  buildSuggestUrl,
  shapeSuggestions,
  createSuggestionFetcher,
  reduceShortcutKey,
  INITIAL_SHORTCUT_STATE,
  CHORD_TIMEOUT_MS,
  MIN_QUERY_LENGTH,
  MAX_SUGGESTIONS,
  type SuggestItem,
} from "../search-client";

// ---------------------------------------------------------------------------
// shouldQuery / buildSuggestUrl
// ---------------------------------------------------------------------------

test("shouldQuery rejects fewer than MIN_QUERY_LENGTH characters", () => {
  assert.equal(shouldQuery(""), false);
  assert.equal(shouldQuery("a"), false);
  assert.equal(shouldQuery("  a  "), false, "trims before counting");
  assert.equal(shouldQuery("a".repeat(MIN_QUERY_LENGTH)), true);
  assert.equal(shouldQuery("ab"), true);
});

test("buildSuggestUrl includes q, limit, and suggest=1", () => {
  const url = buildSuggestUrl("pr review", 6);
  assert.match(url, /^\/api\/v1\/search\?/);
  const params = new URLSearchParams(url.split("?")[1]);
  assert.equal(params.get("q"), "pr review");
  assert.equal(params.get("limit"), "6");
  assert.equal(params.get("suggest"), "1");
});

test("buildSuggestUrl defaults limit to MAX_SUGGESTIONS", () => {
  const url = buildSuggestUrl("rag");
  const params = new URLSearchParams(url.split("?")[1]);
  assert.equal(params.get("limit"), String(MAX_SUGGESTIONS));
});

// ---------------------------------------------------------------------------
// shapeSuggestions (result shaping)
// ---------------------------------------------------------------------------

const VALID_ITEM: SuggestItem = {
  id: "acme/pr-reviewer",
  owner: "acme",
  name: "pr-reviewer",
  title: "PR Reviewer",
  kind: "workflow",
  pricing: { model: "free" },
};

test("shapeSuggestions passes through a well-formed response", () => {
  const shaped = shapeSuggestions({ items: [VALID_ITEM], total: 1 });
  assert.deepEqual(shaped, { items: [VALID_ITEM], total: 1 });
});

test("shapeSuggestions keeps correctedQuery only when it's a string", () => {
  const withCorrection = shapeSuggestions({ items: [], total: 0, correctedQuery: "harness" });
  assert.equal(withCorrection.correctedQuery, "harness");

  const withoutCorrection = shapeSuggestions({ items: [], total: 0, correctedQuery: 42 });
  assert.equal(withoutCorrection.correctedQuery, undefined);
});

test("shapeSuggestions drops malformed items instead of throwing", () => {
  const shaped = shapeSuggestions({
    items: [VALID_ITEM, { id: "bad" }, null, "nope", { ...VALID_ITEM, pricing: null }],
    total: 5,
  });
  assert.deepEqual(shaped.items, [VALID_ITEM]);
});

test("shapeSuggestions caps items at MAX_SUGGESTIONS", () => {
  const items = Array.from({ length: MAX_SUGGESTIONS + 4 }, (_, i) => ({
    ...VALID_ITEM,
    id: `acme/pkg-${i}`,
    name: `pkg-${i}`,
  }));
  const shaped = shapeSuggestions({ items, total: items.length });
  assert.equal(shaped.items.length, MAX_SUGGESTIONS);
});

test("shapeSuggestions never throws on garbage input", () => {
  for (const bad of [null, undefined, "string", 42, [], {}]) {
    assert.doesNotThrow(() => shapeSuggestions(bad));
  }
  assert.deepEqual(shapeSuggestions(null), { items: [], total: 0 });
  assert.deepEqual(shapeSuggestions(undefined), { items: [], total: 0 });
});

// ---------------------------------------------------------------------------
// createSuggestionFetcher: debounce + abort
// ---------------------------------------------------------------------------
//
// These use real timers with a short debounce window rather than
// `node:test`'s `mock.timers`: this file's top-level tests run with enough
// concurrency that two tests independently enabling/resetting the *shared*
// process-wide mock clock (`mock.timers` is one singleton, not scoped per
// test) can interleave and corrupt each other's clock — real timers sidestep
// that entirely at the cost of a few tens of milliseconds of wall time.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Short enough to keep this file fast, long enough to comfortably tell apart
// "before" and "after" on a loaded CI machine.
const TEST_DEBOUNCE_MS = 20;

test("does not call fetch for a query shorter than MIN_QUERY_LENGTH", () => {
  let fetchCalls = 0;
  const fakeFetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ items: [], total: 0 }));
  }) as typeof fetch;

  const { fetchSuggestions } = createSuggestionFetcher(fakeFetch);
  const results: (unknown | null)[] = [];
  fetchSuggestions("a", (r) => results.push(r));

  assert.equal(fetchCalls, 0);
  assert.deepEqual(results, [null]);
});

test("debounces rapid calls into a single request for the latest query", async () => {
  const seenUrls: string[] = [];
  const fakeFetch = (async (url: string) => {
    seenUrls.push(url);
    return new Response(JSON.stringify({ items: [], total: 0 }));
  }) as typeof fetch;

  const { fetchSuggestions } = createSuggestionFetcher(fakeFetch, TEST_DEBOUNCE_MS);
  const results: (unknown | null)[] = [];
  fetchSuggestions("re", (r) => results.push(r));
  await sleep(TEST_DEBOUNCE_MS / 2);
  fetchSuggestions("rev", (r) => results.push(r));
  await sleep(TEST_DEBOUNCE_MS / 2);
  fetchSuggestions("review", (r) => results.push(r));

  // Nothing should have fired yet — each call reset the debounce timer.
  assert.equal(seenUrls.length, 0);

  await sleep(TEST_DEBOUNCE_MS * 3);

  assert.equal(seenUrls.length, 1, "only the final call should reach the network");
  assert.match(seenUrls[0], /q=review/);
  assert.equal(results.length, 1);
});

test("aborts an in-flight request when superseded, and drops its callback", async () => {
  const abortedSignals: AbortSignal[] = [];
  let callCount = 0;

  // The first call never resolves on its own — it's meant to be superseded
  // and only ever settles via abort. Every later call resolves normally.
  const fakeFetch = ((_url: string, init?: RequestInit) => {
    callCount += 1;
    const isFirstCall = callCount === 1;
    const signal = init?.signal as AbortSignal;
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        abortedSignals.push(signal);
        reject(new DOMException("Aborted", "AbortError"));
      });
      if (!isFirstCall) {
        resolve(new Response(JSON.stringify({ items: [], total: 0 })));
      }
    });
  }) as typeof fetch;

  const { fetchSuggestions } = createSuggestionFetcher(fakeFetch, TEST_DEBOUNCE_MS);
  const results: (unknown | null)[] = [];

  fetchSuggestions("harness", (r) => results.push(["first", r]));
  await sleep(TEST_DEBOUNCE_MS * 3); // first request starts (never resolves on its own)

  fetchSuggestions("harnesses", (r) => results.push(["second", r]));
  await sleep(TEST_DEBOUNCE_MS * 3); // second request starts, first is aborted

  assert.equal(abortedSignals.length, 1, "the first request's signal should be aborted");
  assert.deepEqual(
    results,
    [["second", { items: [], total: 0 }]],
    "the superseded first call's onResult should never fire"
  );
});

test("resolves with null (not a throw) on a network error", async () => {
  const fakeFetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  const { fetchSuggestions } = createSuggestionFetcher(fakeFetch, TEST_DEBOUNCE_MS);
  const results: (unknown | null)[] = [];
  fetchSuggestions("harness", (r) => results.push(r));
  await sleep(TEST_DEBOUNCE_MS * 3);

  assert.deepEqual(results, [null]);
});

test("resolves with null on a non-OK HTTP response", async () => {
  const fakeFetch = (async () => new Response("oops", { status: 500 })) as typeof fetch;

  const { fetchSuggestions } = createSuggestionFetcher(fakeFetch, TEST_DEBOUNCE_MS);
  const results: (unknown | null)[] = [];
  fetchSuggestions("harness", (r) => results.push(r));
  await sleep(TEST_DEBOUNCE_MS * 3);

  assert.deepEqual(results, [null]);
});

test("cancel() clears a pending timer and aborts an in-flight request", async () => {
  let fetchStarted = false;
  let aborted = false;
  const fakeFetch = ((_url: string, init?: RequestInit) => {
    fetchStarted = true;
    const signal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }) as typeof fetch;

  const { fetchSuggestions, cancel } = createSuggestionFetcher(fakeFetch, TEST_DEBOUNCE_MS);
  const results: (unknown | null)[] = [];
  fetchSuggestions("harness", (r) => results.push(r));

  // Cancel before the debounce timer fires: fetch should never even start.
  cancel();
  await sleep(TEST_DEBOUNCE_MS * 3);
  assert.equal(fetchStarted, false);
  assert.equal(results.length, 0);

  fetchSuggestions("harnesses", (r) => results.push(r));
  await sleep(TEST_DEBOUNCE_MS * 3);
  assert.equal(fetchStarted, true);

  cancel();
  await sleep(0);
  assert.equal(aborted, true);
});

// ---------------------------------------------------------------------------
// reduceShortcutKey (pure shortcut key-sequence parser)
// ---------------------------------------------------------------------------

test("'/' focuses search from the initial state", () => {
  const { state, action } = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "/" }, 1000);
  assert.deepEqual(action, { type: "focus-search" });
  assert.deepEqual(state, INITIAL_SHORTCUT_STATE);
});

test("'?' opens the help dialog", () => {
  const { action } = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "?" }, 1000);
  assert.deepEqual(action, { type: "help" });
});

test("a lone 'g' sets a pending chord with no action", () => {
  const { state, action } = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "g" }, 1000);
  assert.equal(action, null);
  assert.deepEqual(state, { pendingPrefix: "g", pendingSince: 1000 });
});

for (const [key, href] of [
  ["e", "/explore"],
  ["h", "/"],
  ["t", "/tags"],
  ["c", "/collections"],
] as const) {
  test(`'g' then '${key}' navigates to ${href}`, () => {
    const afterG = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "g" }, 1000);
    const afterChord = reduceShortcutKey(afterG.state, { key }, 1050);
    assert.deepEqual(afterChord.action, { type: "navigate", href });
    assert.deepEqual(afterChord.state, INITIAL_SHORTCUT_STATE, "chord resets after firing");
  });
}

test("'g' then an unrelated key abandons the chord without an action", () => {
  const afterG = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "g" }, 1000);
  const afterOther = reduceShortcutKey(afterG.state, { key: "z" }, 1050);
  assert.equal(afterOther.action, null);
  assert.deepEqual(afterOther.state, INITIAL_SHORTCUT_STATE);
});

test("a chord that times out is treated as abandoned", () => {
  const afterG = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "g" }, 1000);
  const tooLate = reduceShortcutKey(afterG.state, { key: "e" }, 1000 + CHORD_TIMEOUT_MS + 1);
  assert.equal(tooLate.action, null, "the chord should have expired");
});

test("a chord right at the timeout boundary still fires", () => {
  const afterG = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "g" }, 1000);
  const justInTime = reduceShortcutKey(afterG.state, { key: "e" }, 1000 + CHORD_TIMEOUT_MS);
  assert.deepEqual(justInTime.action, { type: "navigate", href: "/explore" });
});

test("'g' then 'g' restarts the chord instead of firing", () => {
  const first = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "g" }, 1000);
  const second = reduceShortcutKey(first.state, { key: "g" }, 1050);
  assert.equal(second.action, null);
  assert.deepEqual(second.state, { pendingPrefix: "g", pendingSince: 1050 });
});

test("modifier keys (ctrl/meta/alt) are ignored and reset any pending chord", () => {
  const afterG = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "g" }, 1000);
  const withCtrl = reduceShortcutKey(afterG.state, { key: "e", ctrlKey: true }, 1050);
  assert.equal(withCtrl.action, null);
  assert.deepEqual(withCtrl.state, INITIAL_SHORTCUT_STATE);

  const slashWithMeta = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "/", metaKey: true }, 1000);
  assert.equal(slashWithMeta.action, null, "Cmd+/ should not be hijacked");
});

test("shift is not treated as a blocking modifier ('?' is Shift+/ on most layouts)", () => {
  const { action } = reduceShortcutKey(
    INITIAL_SHORTCUT_STATE,
    { key: "?", ctrlKey: false, metaKey: false, altKey: false },
    1000
  );
  assert.deepEqual(action, { type: "help" });
});

test("an unrecognized key with no pending chord produces no action", () => {
  const { state, action } = reduceShortcutKey(INITIAL_SHORTCUT_STATE, { key: "x" }, 1000);
  assert.equal(action, null);
  assert.deepEqual(state, INITIAL_SHORTCUT_STATE);
});
