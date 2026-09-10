"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProfileFormProps {
  initialName: string;
  initialBio: string;
  initialWebsite: string;
  initialHandle: string;
  /** True when the caller owns at least one published package — the handle
   *  field is locked in that case (changing it would orphan `packages.owner`). */
  handleLocked: boolean;
}

export function ProfileForm({
  initialName,
  initialBio,
  initialWebsite,
  initialHandle,
  handleLocked,
}: ProfileFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [website, setWebsite] = useState(initialWebsite);
  const [handle, setHandle] = useState(initialHandle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/v1/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, bio, website, handle }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError((data && typeof data === "object" && "error" in data ? String(data.error) : null) ?? "Couldn't save your profile.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Couldn't save your profile. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-5">
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-border-strong focus:outline-none"
        />
      </Field>

      <Field label="Bio" hint={`${bio.length}/500`}>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
          rows={3}
          className="w-full resize-y rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-border-strong focus:outline-none"
        />
      </Field>

      <Field label="Website">
        <input
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://example.com"
          className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
        />
      </Field>

      <Field
        label="Handle"
        hint={
          handleLocked
            ? "You can't change your handle while you own published packages."
            : "Lowercase letters, digits, and hyphens. 2-39 characters."
        }
      >
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-fg-subtle">@</span>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            disabled={handleLocked}
            maxLength={39}
            className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-sm text-fg focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      </Field>

      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && !error && <p className="text-sm text-accent">Saved.</p>}

      <div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}
