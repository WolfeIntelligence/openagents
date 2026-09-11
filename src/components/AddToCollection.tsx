"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface OwnCollection {
  id: string;
  owner: string;
  slug: string;
  title: string;
}

/**
 * Small popover next to the star button: lists the signed-in user's own
 * collections with a checkbox each, adding/removing this package via
 * `PUT`/`DELETE .../items`, plus a "New collection…" link. Signed-out shows a
 * sign-in link instead of the button; renders nothing when `enabled` is false
 * (no database configured on this deployment).
 */
export function AddToCollection({
  owner,
  name,
  signedIn,
  enabled,
}: {
  owner: string;
  name: string;
  signedIn: boolean;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<OwnCollection[] | null>(null);
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open || collections !== null) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const meRes = await fetch("/api/v1/me");
        if (!meRes.ok) throw new Error("not signed in");
        const me = (await meRes.json()) as { handle: string | null };
        if (!me.handle) {
          if (!cancelled) {
            setError("Set a handle in your profile before creating collections.");
            setCollections([]);
          }
          return;
        }

        const listRes = await fetch(`/api/v1/collections?owner=${encodeURIComponent(me.handle)}&limit=100`);
        if (!listRes.ok) throw new Error(String(listRes.status));
        const data = (await listRes.json()) as { items: OwnCollection[] };
        if (cancelled) return;
        setCollections(data.items);

        const memberships = await Promise.all(
          data.items.map(async (c) => {
            const res = await fetch(`/api/v1/collections/${c.owner}/${c.slug}`);
            if (!res.ok) return null;
            const detail = (await res.json()) as { items: { owner: string; name: string }[] };
            const has = detail.items.some((i) => i.owner === owner && i.name === name);
            return has ? c.id : null;
          })
        );
        if (!cancelled) {
          setMemberOf(new Set(memberships.filter((id): id is string => id !== null)));
        }
      } catch {
        if (!cancelled) setError("Couldn't load your collections. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, collections, owner, name]);

  if (!enabled) return null;

  if (!signedIn) {
    return (
      <Link
        href={`/signin?callbackUrl=/p/${owner}/${name}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-fg hover:border-border-strong"
      >
        Add to collection
      </Link>
    );
  }

  async function toggle(c: OwnCollection) {
    const isMember = memberOf.has(c.id);
    setPending((p) => new Set(p).add(c.id));
    try {
      const res = isMember
        ? await fetch(`/api/v1/collections/${c.owner}/${c.slug}/items/${owner}/${name}`, { method: "DELETE" })
        : await fetch(`/api/v1/collections/${c.owner}/${c.slug}/items`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner, name }),
          });
      if (!res.ok) throw new Error(String(res.status));
      setMemberOf((prev) => {
        const next = new Set(prev);
        if (isMember) next.delete(c.id);
        else next.add(c.id);
        return next;
      });
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(c.id);
        return next;
      });
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-fg hover:border-border-strong"
      >
        Add to collection
      </button>

      {open && (
        <div className="absolute left-0 z-10 mt-2 w-64 rounded-lg border border-border bg-surface p-3 shadow-lg">
          {loading && <p className="text-sm text-fg-muted">Loading…</p>}
          {error && <p className="text-xs text-danger">{error}</p>}
          {!loading && collections && collections.length === 0 && !error && (
            <p className="text-sm text-fg-muted">You don&apos;t have any collections yet.</p>
          )}
          {!loading && collections && collections.length > 0 && (
            <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {collections.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-fg hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      checked={memberOf.has(c.id)}
                      disabled={pending.has(c.id)}
                      onChange={() => void toggle(c)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span className="truncate">{c.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/collections/new"
            className="mt-2 block border-t border-border pt-2 text-sm font-medium text-accent hover:text-accent-hover"
          >
            New collection…
          </Link>
        </div>
      )}
    </div>
  );
}
