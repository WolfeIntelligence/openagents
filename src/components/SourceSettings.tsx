"use client";

import { useState, type FormEvent } from "react";

export interface OwnedPackage {
  id: string; // "owner/name"
  owner: string;
  name: string;
  title: string;
}

export interface SourceLink {
  id: string;
  repo: string;
  ref: string | null;
  subdir: string | null;
  lastSyncedAt: string | null;
  lastResult: string | null;
  webhookUrl: string;
  /** null when a webhook key rotation means the stored secret can no longer be
   *  reproduced — the seller needs to re-link to get a fresh one. */
  secret: string | null;
}

interface LinkResponse {
  id: string;
  repo: string;
  ref: string | null;
  subdir: string | null;
  webhookUrl: string;
  secret: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  if (data && typeof data === "object" && "error" in data) {
    return String((data as { error?: unknown }).error) || fallback;
  }
  return fallback;
}

export function SourceSettings({
  ownedPackages,
  initialLinks,
}: {
  ownedPackages: OwnedPackage[];
  initialLinks: Record<string, SourceLink>;
}) {
  const [links, setLinks] = useState<Record<string, SourceLink>>(initialLinks);

  function setLink(pkgId: string, link: SourceLink) {
    setLinks((prev) => ({ ...prev, [pkgId]: link }));
  }

  function clearLink(pkgId: string) {
    setLinks((prev) => {
      const next = { ...prev };
      delete next[pkgId];
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {ownedPackages.map((pkg) => (
        <PackageSourceCard
          key={pkg.id}
          pkg={pkg}
          link={links[pkg.id] ?? null}
          onLinked={(link) => setLink(pkg.id, link)}
          onUnlinked={() => clearLink(pkg.id)}
        />
      ))}
    </div>
  );
}

function PackageSourceCard({
  pkg,
  link,
  onLinked,
  onUnlinked,
}: {
  pkg: OwnedPackage;
  link: SourceLink | null;
  onLinked: (link: SourceLink) => void;
  onUnlinked: () => void;
}) {
  const [editing, setEditing] = useState(!link);
  const [repo, setRepo] = useState(link?.repo ?? "");
  const [ref, setRef] = useState(link?.ref ?? "");
  const [subdir, setSubdir] = useState(link?.subdir ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [copied, setCopied] = useState<"url" | "secret" | null>(null);

  async function handleLink(e: FormEvent) {
    e.preventDefault();
    const trimmedRepo = repo.trim();
    if (!trimmedRepo) {
      setSaveError("Repo is required.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/v1/packages/${pkg.owner}/${pkg.name}/source`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: trimmedRepo,
          ref: ref.trim() || undefined,
          subdir: subdir.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setSaveError(await readError(res, `Failed to link (${res.status}).`));
        return;
      }
      const data = (await res.json()) as LinkResponse;
      onLinked({
        id: data.id,
        repo: data.repo,
        ref: data.ref,
        subdir: data.subdir,
        lastSyncedAt: null,
        lastResult: null,
        webhookUrl: data.webhookUrl,
        secret: data.secret,
      });
      setEditing(false);
      setSyncResult(null);
    } catch {
      setSaveError("Network error while linking. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`/api/v1/packages/${pkg.owner}/${pkg.name}/source/sync`, { method: "POST" });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setSyncResult(await readError(res, `Sync failed (${res.status}).`));
        return;
      }
      const result =
        data && typeof data === "object" && "result" in data
          ? String((data as { result?: unknown }).result)
          : "Synced.";
      setSyncResult(result);
    } catch {
      setSyncResult("Network error while syncing. Try again.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleUnlink() {
    if (!window.confirm(`Unlink ${pkg.id} from GitHub? The webhook will stop working immediately.`)) {
      return;
    }
    setUnlinking(true);
    try {
      const res = await fetch(`/api/v1/packages/${pkg.owner}/${pkg.name}/source`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        setSaveError(await readError(res, `Failed to unlink (${res.status}).`));
        return;
      }
      onUnlinked();
      setRepo("");
      setRef("");
      setSubdir("");
      setEditing(true);
    } catch {
      setSaveError("Network error while unlinking. Try again.");
    } finally {
      setUnlinking(false);
    }
  }

  async function handleCopy(kind: "url" | "secret", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="rounded-lg border border-border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-fg">{pkg.title}</h2>
        <span className="font-mono text-xs text-fg-subtle">{pkg.id}</span>
      </div>

      {link && !editing ? (
        <div className="mt-3 flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-fg-subtle">Repo</dt>
            <dd className="font-mono text-fg">
              {link.repo}
              {link.ref ? `@${link.ref}` : ""}
              {link.subdir ? `/${link.subdir}` : ""}
            </dd>
            <dt className="text-fg-subtle">Last sync</dt>
            <dd className="text-fg">
              {link.lastSyncedAt ? `${formatDate(link.lastSyncedAt)} — ${link.lastResult ?? ""}` : "never"}
            </dd>
          </dl>

          {link.secret === null ? (
            <p className="text-sm text-danger">
              Re-link required — the signing key changed since this was linked. Link again below
              to get a fresh webhook secret.
            </p>
          ) : (
            <div className="rounded-md border border-border bg-surface p-3 text-xs">
              <p className="text-fg-subtle">
                GitHub → repo Settings → Webhooks → Add webhook. Content type{" "}
                <code className="font-mono">application/json</code>. Events: Releases (or just the
                push event, for tag pushes).
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-fg-subtle">Payload URL</span>
                <code className="break-all rounded border border-border bg-bg px-2 py-1 font-mono">
                  {link.webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy("url", link.webhookUrl)}
                  className="rounded border border-border px-2 py-1 font-medium text-fg hover:border-border-strong"
                >
                  {copied === "url" ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-fg-subtle">Secret</span>
                <code className="break-all rounded border border-border bg-bg px-2 py-1 font-mono">
                  {link.secret}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy("secret", link.secret!)}
                  className="rounded border border-border px-2 py-1 font-medium text-fg hover:border-border-strong"
                >
                  {copied === "secret" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {syncResult && <p className="text-sm text-fg-muted">{syncResult}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={unlinking}
              className="rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
            >
              {unlinking ? "Unlinking…" : "Unlink"}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleLink} className="mt-3 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-fg-subtle">
                Repo (owner/repo or full GitHub URL)
              </label>
              <input
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="acme/agent-pack"
                className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-subtle">Ref (optional)</label>
              <input
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="default branch"
                className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-fg-subtle">Subdir (optional)</label>
              <input
                type="text"
                value={subdir}
                onChange={(e) => setSubdir(e.target.value)}
                placeholder="repo root"
                className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
              />
            </div>
          </div>

          {saveError && <p className="text-sm text-danger">{saveError}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-fit items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? "Linking…" : link ? "Update link" : "Link repo"}
            </button>
            {link && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setSaveError(null);
                }}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:border-border-strong"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
