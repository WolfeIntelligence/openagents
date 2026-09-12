// Pure/testable client-side helpers for Z7 (search-as-you-type + keyboard
// shortcuts). Kept dependency-free (no DOM globals at module scope, no React)
// so `npm test` (plain `node --test` via tsx — see scripts/run-tests.mjs) can
// import this file directly; the components that use it (SearchBox,
// SearchSuggestions, KeyboardShortcuts) hold all the DOM/React glue.

import type { PackageKind, PricingModel } from "@/lib/types";

// ---------------------------------------------------------------------------
// Search suggestions: request shaping, debounce, abort.
// ---------------------------------------------------------------------------

/** Slim shape returned by `GET /api/v1/search?...&suggest=1` — see the
 *  contract in `src/app/api/v1/search/route.ts`. */
export interface SuggestItem {
  id: string;
  owner: string;
  name: string;
  title: string;
  kind: PackageKind;
  pricing: { model: PricingModel };
}

export interface SuggestResult {
  items: SuggestItem[];
  total: number;
  correctedQuery?: string;
}

export const MIN_QUERY_LENGTH = 2;
export const SUGGEST_DEBOUNCE_MS = 150;
export const MAX_SUGGESTIONS = 6;

/** Whether `q` is long enough to be worth a network request. */
export function shouldQuery(q: string): boolean {
  return q.trim().length >= MIN_QUERY_LENGTH;
}

/** Builds the request URL for the suggest endpoint. */
export function buildSuggestUrl(q: string, limit: number = MAX_SUGGESTIONS): string {
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit), suggest: "1" });
  return `/api/v1/search?${params.toString()}`;
}

function isSuggestItem(value: unknown): value is SuggestItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.owner === "string" &&
    typeof v.name === "string" &&
    typeof v.title === "string" &&
    typeof v.kind === "string" &&
    typeof v.pricing === "object" &&
    v.pricing !== null &&
    typeof (v.pricing as Record<string, unknown>).model === "string"
  );
}

/**
 * Validates/normalizes a raw (untyped, possibly malformed) JSON response
 * into a `SuggestResult`. Never throws — an API that errors or returns
 * something unexpected shapes down to an empty result so the UI can stay
 * silent about it (contract: "graceful when the API errors").
 */
export function shapeSuggestions(raw: unknown): SuggestResult {
  if (!raw || typeof raw !== "object") return { items: [], total: 0 };
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items.filter(isSuggestItem).slice(0, MAX_SUGGESTIONS) : [];
  const total = typeof r.total === "number" && Number.isFinite(r.total) ? r.total : items.length;
  const correctedQuery = typeof r.correctedQuery === "string" ? r.correctedQuery : undefined;
  return correctedQuery ? { items, total, correctedQuery } : { items, total };
}

export type SuggestListener = (result: SuggestResult | null) => void;

/**
 * Creates a debounced, abortable fetcher for search suggestions.
 *
 * Calling `fetchSuggestions(q, onResult)` again before the debounce timer or
 * an in-flight request from a previous call has settled supersedes it: the
 * previous timer is cleared, the previous request (if any) is aborted, and
 * its `onResult` is never called — only the most recent call's callback ever
 * fires. A query shorter than `MIN_QUERY_LENGTH` resolves synchronously with
 * `onResult(null)` and never touches the network. Network/parse errors
 * (including intentional aborts) also resolve with `onResult(null)`.
 */
export function createSuggestionFetcher(
  fetchImpl: typeof fetch = fetch,
  debounceMs: number = SUGGEST_DEBOUNCE_MS
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let requestId = 0;

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (controller) {
      controller.abort();
      controller = null;
    }
    // Bump the id even when there was nothing pending, so any response that
    // somehow lands later from a call already superseded is still dropped.
    requestId += 1;
  }

  function fetchSuggestions(q: string, onResult: SuggestListener): void {
    // Clear any previous timer/request, but don't bump requestId here — the
    // id for *this* call is minted below once we know it's actually going
    // to run (a bumped id with nothing to compare against is harmless, but
    // minting it below keeps the "current id" concept in one place).
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (controller) {
      controller.abort();
      controller = null;
    }

    if (!shouldQuery(q)) {
      requestId += 1;
      onResult(null);
      return;
    }

    const myId = ++requestId;
    timer = setTimeout(() => {
      timer = null;
      const ac = new AbortController();
      controller = ac;
      fetchImpl(buildSuggestUrl(q), { signal: ac.signal })
        .then(async (res) => {
          if (myId !== requestId) return; // superseded while the request was in flight
          if (!res.ok) {
            onResult(null);
            return;
          }
          const data: unknown = await res.json();
          if (myId !== requestId) return;
          onResult(shapeSuggestions(data));
        })
        .catch(() => {
          // Aborted (expected when superseded) or a network/parse error —
          // either way, silently no suggestions per contract.
          if (myId !== requestId) return;
          onResult(null);
        });
    }, debounceMs);
  }

  return { fetchSuggestions, cancel };
}

// ---------------------------------------------------------------------------
// Keyboard shortcut key-sequence parser (pure).
// ---------------------------------------------------------------------------

export type ShortcutAction =
  | { type: "focus-search" }
  | { type: "navigate"; href: string }
  | { type: "help" };

export interface ShortcutKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export interface ShortcutParserState {
  /** Set right after a lone "g" while waiting to see if a chord follows. */
  pendingPrefix: "g" | null;
  /** `Date.now()`-style timestamp `pendingPrefix` was set at. */
  pendingSince: number;
}

export const INITIAL_SHORTCUT_STATE: ShortcutParserState = {
  pendingPrefix: null,
  pendingSince: 0,
};

/** How long a leading "g" stays "pending" before the chord is considered abandoned. */
export const CHORD_TIMEOUT_MS = 900;

/** "g" + this key navigates to the given path (`g e`, `g h`, `g t`, `g c`). */
const CHORD_DESTINATIONS: Record<string, string> = {
  e: "/explore",
  h: "/",
  t: "/tags",
  c: "/collections",
};

/**
 * Pure reducer over keydown events: given the current parser state and the
 * next key event (plus the current time, passed in explicitly so this is
 * deterministically testable with a fake clock), returns the next state and
 * the action to perform, if any.
 *
 * Only bare keypresses are recognized — anything held with Ctrl/Cmd/Alt is
 * left alone (so e.g. Cmd+/ isn't hijacked) and resets any pending chord.
 * Shift is not checked: "?" is `Shift+/` on most layouts, and browsers
 * already report the produced character in `event.key`.
 */
export function reduceShortcutKey(
  state: ShortcutParserState,
  event: ShortcutKeyEvent,
  now: number
): { state: ShortcutParserState; action: ShortcutAction | null } {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return { state: INITIAL_SHORTCUT_STATE, action: null };
  }

  const hasPendingChord =
    state.pendingPrefix === "g" && now - state.pendingSince <= CHORD_TIMEOUT_MS;

  if (hasPendingChord) {
    const href = CHORD_DESTINATIONS[event.key.toLowerCase()];
    if (href) {
      return { state: INITIAL_SHORTCUT_STATE, action: { type: "navigate", href } };
    }
    // Falls through: any other key abandons the pending chord and is
    // reconsidered as a fresh keypress below (so "g" then "g" restarts it,
    // "g" then "/" still focuses search, etc).
  }

  if (event.key === "g") {
    return { state: { pendingPrefix: "g", pendingSince: now }, action: null };
  }
  if (event.key === "/") {
    return { state: INITIAL_SHORTCUT_STATE, action: { type: "focus-search" } };
  }
  if (event.key === "?") {
    return { state: INITIAL_SHORTCUT_STATE, action: { type: "help" } };
  }
  return { state: INITIAL_SHORTCUT_STATE, action: null };
}
