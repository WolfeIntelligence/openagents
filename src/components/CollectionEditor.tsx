"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface EditableItem {
  owner: string;
  name: string;
  note: string | null;
  position: number;
  /** Package title, for display only — falls back to `owner/name` when absent
   *  (e.g. the package was removed from the catalog after being added here). */
  title?: string;
}

function itemKey(item: { owner: string; name: string }): string {
  return `${item.owner}/${item.name}`;
}

/**
 * Owner-only inline editor rendered on `/c/[handle]/[slug]`: reorder items
 * (up/down — no drag-and-drop dependency needed for a list this short),
 * remove one, edit its note, and toggle the collection's public/private
 * flag. Every action is optimistic-ish (local state updates immediately,
 * then a `router.refresh()` reconciles with the server) and rolls back with
 * an error message on failure.
 */
export function CollectionEditor({
  handle,
  slug,
  initialIsPublic,
  initialItems,
}: {
  handle: string;
  slug: string;
  initialIsPublic: boolean;
  initialItems: EditableItem[];
}) {
  const router = useRouter();
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [items, setItems] = useState(() => [...initialItems].sort((a, b) => a.position - b.position));
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialItems.map((i) => [itemKey(i), i.note ?? ""]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function putItem(item: EditableItem, patch: { note?: string | null; position?: number }) {
    const res = await fetch(`/api/v1/collections/${handle}/${slug}/items`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: item.owner, name: item.name, ...patch }),
    });
    if (!res.ok) throw new Error(String(res.status));
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    setBusy(true);
    setError(null);
    try {
      await Promise.all(next.map((item, position) => putItem(item, { position })));
      router.refresh();
    } catch {
      setItems(items); // roll back to the pre-move order
      setError("Couldn't save the new order. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(item: EditableItem) {
    setBusy(true);
    setError(null);
    try {
      await putItem(item, { note: noteDrafts[itemKey(item)]?.trim() || null });
      router.refresh();
    } catch {
      setError("Couldn't save that note. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: EditableItem) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/collections/${handle}/${slug}/items/${item.owner}/${item.name}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(String(res.status));
      setItems((prev) => prev.filter((i) => itemKey(i) !== itemKey(item)));
      router.refresh();
    } catch {
      setError("Couldn't remove that package. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePublic() {
    const next = !isPublic;
    setIsPublic(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/collections/${handle}/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setIsPublic(!next);
      setError("Couldn't change visibility. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">Manage this collection</h2>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={isPublic}
            disabled={busy}
            onChange={() => void togglePublic()}
            className="h-4 w-4 rounded border-border"
          />
          Public
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">No packages yet — add some from their pages.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((item, index) => (
            <li
              key={itemKey(item)}
              className="flex flex-col gap-2 rounded-md border border-border p-2.5 sm:flex-row sm:items-start"
            >
              <div className="flex shrink-0 gap-1 sm:flex-col">
                <button
                  type="button"
                  disabled={busy || index === 0}
                  onClick={() => void move(index, -1)}
                  aria-label="Move up"
                  className="rounded border border-border px-1.5 py-0.5 text-xs text-fg hover:border-border-strong disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={busy || index === items.length - 1}
                  onClick={() => void move(index, 1)}
                  aria-label="Move down"
                  className="rounded border border-border px-1.5 py-0.5 text-xs text-fg hover:border-border-strong disabled:opacity-40"
                >
                  ↓
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{item.title ?? itemKey(item)}</p>
                <p className="truncate font-mono text-xs text-fg-subtle">{itemKey(item)}</p>
                <input
                  type="text"
                  value={noteDrafts[itemKey(item)] ?? ""}
                  onChange={(e) => setNoteDrafts((d) => ({ ...d, [itemKey(item)]: e.target.value }))}
                  onBlur={() => void saveNote(item)}
                  placeholder="Add a note…"
                  disabled={busy}
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg"
                />
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(item)}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-fg hover:border-border-strong"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
