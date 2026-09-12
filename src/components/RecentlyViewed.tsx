"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { KindBadge } from "@/components/KindBadge";
import type { PackageKind } from "@/lib/types";

const STORAGE_KEY = "oa:recent";
const MAX_ENTRIES = 8;

interface RecentEntry {
  id: string; // "owner/name"
  title: string;
  kind: PackageKind;
  at: number; // epoch ms, newest first once stored
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.kind === "string" &&
    typeof v.at === "number"
  );
}

/** Raw (un-parsed) read of the storage slot. Never throws — storage may be
 *  unavailable (private browsing, quota, SSR) — `""` is the safe fallback,
 *  same as "nothing recorded yet". */
function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function parseEntries(raw: string): RecentEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentEntry) : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: RecentEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or disabled — the visit just won't be remembered.
  }
  emitChange();
}

function recordVisit(entry: Omit<RecentEntry, "at">): void {
  const deduped = parseEntries(readRaw()).filter((e) => e.id !== entry.id);
  const next = [{ ...entry, at: Date.now() }, ...deduped].slice(0, MAX_ENTRIES);
  writeEntries(next);
}

function clearEntries(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do if storage itself is unavailable.
  }
  emitChange();
}

// --- useSyncExternalStore plumbing -----------------------------------------
//
// localStorage isn't a React-observable store, so reading it needs the same
// treatment as any other external system: `useSyncExternalStore` renders
// `getServerSnapshot()` ("" — nothing recorded) during SSR and the initial
// hydration pass, then transparently re-renders with the real client value
// right after — no hydration-mismatch warning, and no `useEffect` + `useState`
// "mounted" flag needed. Writes made through `writeEntries`/`clearEntries`
// above call `emitChange()` so the *same tab* re-renders immediately (a
// native `storage` event only fires in *other* tabs).

type Listener = () => void;
const listeners = new Set<Listener>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  function onStorage(e: StorageEvent) {
    if (e.key === STORAGE_KEY || e.key === null) listener();
  }
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot(): string {
  return "";
}

/**
 * Records the current package page as "recently viewed". Renders nothing —
 * mount this as the last child of a package page
 * (`src/app/p/[owner]/[name]/page.tsx`) to record a visit on mount.
 *
 * A plain named export, not `RecentlyViewed.Record` — a "use client" module's
 * exports are replaced with opaque client-reference objects when imported
 * from a Server Component (which is exactly where the package page uses
 * this), and a static property attached to the exported function at runtime
 * doesn't survive that substitution.
 */
export function RecentlyViewedRecord({
  owner,
  name,
  title,
  kind,
}: {
  owner: string;
  name: string;
  title: string;
  kind: PackageKind;
}) {
  useEffect(() => {
    recordVisit({ id: `${owner}/${name}`, title, kind });
    // Intentionally runs once per mount: a different package page is a
    // different mount of this component (new route params), so there's no
    // dependency to react to afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * "Recently viewed" chip rail for the landing page. Renders `null` on the
 * server and until hydrated (see the `useSyncExternalStore` note above), and
 * renders `null` whenever there's nothing recorded yet.
 */
export function RecentlyViewed() {
  const raw = useSyncExternalStore(subscribe, readRaw, getServerSnapshot);
  const entries = parseEntries(raw);

  if (entries.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg-muted">Recently viewed</h2>
        <button
          type="button"
          onClick={clearEntries}
          className="text-xs font-medium text-fg-subtle hover:text-fg"
        >
          Clear
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {entries.map((entry) => {
          const slash = entry.id.indexOf("/");
          const owner = slash === -1 ? entry.id : entry.id.slice(0, slash);
          const name = slash === -1 ? entry.id : entry.id.slice(slash + 1);
          return (
            <Link
              key={entry.id}
              href={`/p/${owner}/${name}`}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
            >
              <KindBadge kind={entry.kind} />
              {entry.title}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
