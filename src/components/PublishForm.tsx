"use client";

import Link from "next/link";
import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";

interface UploadedFile {
  path: string;
  content: string;
}

type DirInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

function stripTopDir(path: string): string {
  const idx = path.indexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

interface PublishSuccess {
  id: string;
  version: string;
  url: string;
  /** Absent on responses from a pre-status backend; treated the same as "live". */
  status?: string;
}

type Mode = "directory" | "github";

export function PublishForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("directory");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [changelog, setChangelog] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoRef, setRepoRef] = useState("");
  const [repoSubdir, setRepoSubdir] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [published, setPublished] = useState<PublishSuccess | null>(null);

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setFileNames(Array.from(fileList).map((f) => f.webkitRelativePath || f.name));
  }

  async function submitJson(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => null)) as PublishSuccess | null;
      if (data?.url) setPublished(data);
      setStatus("success");
      return;
    }

    const data: unknown = await res.json().catch(() => null);
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error)
        : `Publish failed (${res.status}).`;
    const details =
      data && typeof data === "object" && "issues" in data && Array.isArray((data as { issues?: unknown }).issues)
        ? (data as { issues: unknown[] }).issues.map(String)
        : [];
    setErrors([message, ...details]);
    setStatus("error");
  }

  async function handleDirectorySubmit(e: FormEvent) {
    e.preventDefault();
    const fileList = inputRef.current?.files;
    if (!fileList || fileList.length === 0) {
      setErrors(["Choose a package directory to upload."]);
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrors([]);

    try {
      const files: UploadedFile[] = await Promise.all(
        Array.from(fileList).map(async (file) => ({
          path: stripTopDir(file.webkitRelativePath || file.name),
          content: await file.text(),
        })),
      );

      await submitJson("/api/v1/publish", {
        files,
        ...(changelog.trim() ? { changelog: changelog.trim() } : {}),
      });
    } catch {
      setErrors(["Network error while publishing. Try again."]);
      setStatus("error");
    }
  }

  async function handleGitHubSubmit(e: FormEvent) {
    e.preventDefault();
    const repo = repoUrl.trim();
    if (!repo) {
      setErrors(["Enter a GitHub repo URL."]);
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrors([]);

    try {
      await submitJson("/api/v1/publish/import", {
        repo,
        ...(repoRef.trim() ? { ref: repoRef.trim() } : {}),
        ...(repoSubdir.trim() ? { subdir: repoSubdir.trim() } : {}),
        ...(changelog.trim() ? { changelog: changelog.trim() } : {}),
      });
    } catch {
      setErrors(["Network error while importing from GitHub. Try again."]);
      setStatus("error");
    }
  }

  if (status === "success") {
    const isPending = published?.status === "pending";
    return (
      <div className="rounded-lg border border-accent-border bg-accent-muted p-6 text-sm text-fg">
        <p className="font-semibold">
          {published ? `${published.id}@${published.version} published.` : "Package published."}
        </p>
        <p className="mt-1 text-fg-muted">
          {isPending
            ? "It's awaiting review before it appears in listings and search."
            : "It's live now, no review queue."}{" "}
          {published ? (
            <Link href={published.url} className="text-accent hover:text-accent-hover">
              View the package
            </Link>
          ) : null}
        </p>
      </div>
    );
  }

  const dirProps: DirInputProps = { webkitdirectory: "", directory: "" };
  const errorBanner = errors.length > 0 && (
    <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      <ul className="list-disc pl-4">
        {errors.map((err, i) => (
          <li key={i}>{err}</li>
        ))}
      </ul>
      {errors.some((err) => /stripe payouts/i.test(err)) && (
        <Link
          href="/settings/payouts"
          className="mt-2 inline-flex text-sm font-medium text-accent hover:text-accent-hover"
        >
          Go to Settings → Payouts
        </Link>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit rounded-md border border-border p-0.5 text-sm">
        {(
          [
            { id: "directory" as const, label: "Upload a directory" },
            { id: "github" as const, label: "Import from GitHub" },
          ]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setMode(tab.id);
              setErrors([]);
            }}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${
              mode === tab.id
                ? "bg-accent text-accent-fg"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "directory" ? (
        <form onSubmit={handleDirectorySubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="oa-publish-files" className="mb-1.5 block text-sm font-medium text-fg">
              Package directory
            </label>
            <input
              id="oa-publish-files"
              ref={inputRef}
              type="file"
              multiple
              onChange={handleFiles}
              {...dirProps}
              className="block w-full text-sm text-fg-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg hover:file:border-border-strong"
            />
            <p className="mt-1.5 text-xs text-fg-subtle">
              Select the folder containing <code className="font-mono">openagent.yaml</code>,{" "}
              <code className="font-mono">README.md</code>, and your package files.
            </p>
          </div>

          {fileNames.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-bg-elevated p-3 text-xs font-mono text-fg-muted">
              {fileNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}

          <ChangelogField value={changelog} onChange={setChangelog} />
          {errorBanner}

          <button
            type="submit"
            disabled={status === "loading"}
            className="inline-flex w-fit items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {status === "loading" ? "Publishing…" : "Publish package"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleGitHubSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="oa-publish-repo" className="mb-1.5 block text-sm font-medium text-fg">
              GitHub repo URL
            </label>
            <input
              id="oa-publish-repo"
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-fg-subtle">
              Or paste a link to a subdirectory, e.g.{" "}
              <code className="font-mono">.../tree/main/packages/my-agent</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="oa-publish-ref" className="mb-1.5 block text-sm font-medium text-fg">
                Branch, tag, or commit{" "}
                <span className="font-normal text-fg-subtle">(optional)</span>
              </label>
              <input
                id="oa-publish-ref"
                type="text"
                value={repoRef}
                onChange={(e) => setRepoRef(e.target.value)}
                placeholder="default branch"
                className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="oa-publish-subdir" className="mb-1.5 block text-sm font-medium text-fg">
                Subdirectory <span className="font-normal text-fg-subtle">(optional)</span>
              </label>
              <input
                id="oa-publish-subdir"
                type="text"
                value={repoSubdir}
                onChange={(e) => setRepoSubdir(e.target.value)}
                placeholder="repo root"
                className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
              />
            </div>
          </div>

          <ChangelogField value={changelog} onChange={setChangelog} />
          {errorBanner}

          <button
            type="submit"
            disabled={status === "loading"}
            className="inline-flex w-fit items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {status === "loading" ? "Importing…" : "Import and publish"}
          </button>
        </form>
      )}
    </div>
  );
}

function ChangelogField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor="oa-publish-changelog" className="mb-1.5 block text-sm font-medium text-fg">
        What changed in this version{" "}
        <span className="font-normal text-fg-subtle">(optional)</span>
      </label>
      <textarea
        id="oa-publish-changelog"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Leave blank to use CHANGELOG.md's first section, if you included one."
        className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
      />
    </div>
  );
}
