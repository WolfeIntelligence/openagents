"use client";

import { useState, type FormEvent } from "react";

const ALL_SCOPES = ["read", "publish", "star", "download"] as const;
type Scope = (typeof ALL_SCOPES)[number];

export interface TokenListItem {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

interface CreatedToken extends TokenListItem {
  token: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function TokenManager({ initialTokens }: { initialTokens: TokenListItem[] }) {
  const [tokens, setTokens] = useState<TokenListItem[]>(initialTokens);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>([...ALL_SCOPES]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  function toggleScope(scope: Scope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError("Name is required.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    setCopied(false);

    try {
      const res = await fetch("/api/v1/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, scopes }),
      });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : `Failed to create token (${res.status}).`;
        setCreateError(message);
        return;
      }

      const created = data as CreatedToken;
      setJustCreated(created);
      setTokens((prev) => [
        {
          id: created.id,
          name: created.name,
          prefix: created.prefix,
          scopes: created.scopes,
          lastUsedAt: created.lastUsedAt,
          createdAt: created.createdAt,
        },
        ...prev,
      ]);
      setName("");
      setScopes([...ALL_SCOPES]);
    } catch {
      setCreateError("Network error while creating the token. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm("Revoke this token? Anything using it will stop working immediately.")) {
      return;
    }

    setRevokingId(id);
    setRevokeError(null);

    try {
      const res = await fetch(`/api/v1/tokens/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const data: unknown = await res.json().catch(() => null);
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : `Failed to revoke token (${res.status}).`;
        setRevokeError(message);
        return;
      }
      setTokens((prev) => prev.filter((t) => t.id !== id));
      if (justCreated?.id === id) setJustCreated(null);
    } catch {
      setRevokeError("Network error while revoking the token. Try again.");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopy() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      {justCreated && (
        <div className="rounded-lg border border-accent-border bg-accent-muted p-4 text-sm text-fg">
          <p className="font-semibold">{`"${justCreated.name}" created.`}</p>
          <p className="mt-1 text-fg-muted">
            Copy it now — this is the only time you&apos;ll see the full token.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-fg">
              {justCreated.token}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg hover:border-border-strong"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-xs text-fg-subtle">
            Use it with the CLI:{" "}
            <code className="font-mono">openagents login --token {justCreated.token.slice(0, 11)}…</code>
          </p>
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-4 rounded-lg border border-border p-5"
      >
        <h2 className="text-base font-semibold text-fg">Create a new token</h2>

        <div>
          <label htmlFor="oa-token-name" className="mb-1.5 block text-sm font-medium text-fg">
            Name
          </label>
          <input
            id="oa-token-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            placeholder="e.g. laptop CLI"
            className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-fg">Scopes</span>
          <div className="flex flex-wrap gap-3">
            {ALL_SCOPES.map((scope) => (
              <label
                key={scope}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-fg-muted has-[:checked]:border-accent-border has-[:checked]:text-fg"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="accent-accent"
                />
                {scope}
              </label>
            ))}
          </div>
        </div>

        {createError && <p className="text-sm text-danger">{createError}</p>}

        <button
          type="submit"
          disabled={creating}
          className="inline-flex w-fit items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create token"}
        </button>
      </form>

      <div>
        <h2 className="text-base font-semibold text-fg">Your tokens</h2>
        {revokeError && <p className="mt-2 text-sm text-danger">{revokeError}</p>}
        {tokens.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">No active tokens yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
              >
                <div>
                  <p className="text-sm font-medium text-fg">{t.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-fg-subtle">oa_{t.prefix}…</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {t.scopes.join(", ") || "no scopes"} · created {formatDate(t.createdAt)} ·{" "}
                    {t.lastUsedAt ? `last used ${formatDate(t.lastUsedAt)}` : "never used"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(t.id)}
                  disabled={revokingId === t.id}
                  className="shrink-0 rounded-md border border-danger/40 px-2.5 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
                >
                  {revokingId === t.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
