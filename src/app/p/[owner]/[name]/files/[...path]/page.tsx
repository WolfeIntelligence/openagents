import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCatalog } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { resolveAccess } from "@/lib/access";
import { CodeBlock } from "@/components/CodeBlock";
import { Markdown } from "@/components/Markdown";
import { resolveLanguage } from "@/lib/highlight";

type Params = { owner: string; name: string; path: string[] };
type FileSearchParams = { view?: string };

/** Extension -> highlight.ts language / display label. `resolveLanguage`
 *  already knows the common ones; this just strips the path down to an
 *  extension for it. */
function languageFor(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return undefined;
  return resolveLanguage(filePath.slice(dot + 1));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { owner, name, path } = await params;
  const filePath = path.join("/");
  return { title: `${filePath} · ${owner}/${name}` };
}

export default async function FileViewerPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<FileSearchParams>;
}) {
  const { owner, name, path } = await params;
  const { view } = await searchParams;
  const filePath = path.join("/");

  const catalog = await getCatalog();
  const [file, pkg] = await Promise.all([
    catalog.getFile(owner, name, filePath),
    catalog.get(owner, name),
  ]);
  if (!file || file.content === undefined || !pkg) notFound();

  // B2: this used to render the file unconditionally. Now a paid package only
  // shows its preview paths (README, manifest) for free — everything else
  // needs the same access a purchase would grant, mirroring the raw-file API
  // and the download route so all three can't disagree.
  const session = await auth();
  const access = await resolveAccess(pkg, session);
  const locked = !access.canReadFile(filePath);

  // G-C4: a .md file defaults to its source (so the file viewer stays a code
  // viewer by default) with an explicit toggle to render it — the inverse of
  // the README tab, which always renders. `?view=rendered` is server-side
  // (no client JS needed to pick a view), matching the rest of this page.
  const isMarkdown = filePath.toLowerCase().endsWith(".md");
  const rendered = isMarkdown && view === "rendered";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <Link href={`/p/${owner}/${name}`} className="font-mono text-fg-muted hover:text-fg">
          {owner}/{name}
        </Link>
        {path.map((segment, i) => {
          const isLast = i === path.length - 1;
          const href = `/p/${owner}/${name}/files/${path.slice(0, i + 1).join("/")}`;
          return (
            <span key={href} className="flex items-center gap-1">
              <span className="text-fg-subtle">/</span>
              {isLast ? (
                <span className="font-mono text-fg" aria-current="page">
                  {segment}
                </span>
              ) : (
                <Link href={href} className="font-mono text-fg-muted hover:text-fg">
                  {segment}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      {locked ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="max-w-sm text-sm text-fg-muted">
            This file is part of a paid package. Buy it to read the full source.
          </p>
          <Link
            href={`/p/${owner}/${name}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong"
          >
            Back to {owner}/{name}
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <p className="text-xs text-fg-subtle">{formatBytes(file.size)}</p>
              {isMarkdown && (
                // G-C4: server-rendered toggle, no client JS required — a
                // plain link to the same page with `?view=` swapped.
                <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
                  <Link
                    href={`/p/${owner}/${name}/files/${filePath}`}
                    aria-current={!rendered ? "page" : undefined}
                    className={`rounded px-2 py-1 font-medium ${
                      !rendered ? "bg-accent-muted text-accent" : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    Source
                  </Link>
                  <Link
                    href={`/p/${owner}/${name}/files/${filePath}?view=rendered`}
                    aria-current={rendered ? "page" : undefined}
                    className={`rounded px-2 py-1 font-medium ${
                      rendered ? "bg-accent-muted text-accent" : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    Rendered
                  </Link>
                </div>
              )}
            </div>
            <a
              href={`/api/v1/packages/${owner}/${name}/files/${filePath}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:border-border-strong"
            >
              Download raw
            </a>
          </div>

          {rendered ? (
            <div className="rounded-lg border border-border bg-bg-elevated p-6">
              <Markdown content={file.content} owner={owner} name={name} />
            </div>
          ) : (
            <CodeBlock code={file.content} language={languageFor(filePath)} showLineNumbers />
          )}
        </>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
