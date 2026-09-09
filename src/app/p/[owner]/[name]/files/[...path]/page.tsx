import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCatalog } from "@/lib/catalog";

type Params = { owner: string; name: string; path: string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { owner, name, path } = await params;
  const filePath = path.join("/");
  return { title: `${filePath} · ${owner}/${name}` };
}

export default async function FileViewerPage({ params }: { params: Promise<Params> }) {
  const { owner, name, path } = await params;
  const filePath = path.join("/");

  const catalog = await getCatalog();
  const file = await catalog.getFile(owner, name, filePath);
  if (!file || file.content === undefined) notFound();

  const lines = file.content.split("\n");

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

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">{formatBytes(file.size)}</p>
        <a
          href={`/api/v1/packages/${owner}/${name}/files/${filePath}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:border-border-strong"
        >
          View raw
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-bg-elevated">
        <pre className="flex text-sm">
          <code className="w-full font-mono">
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td className="select-none border-r border-border px-3 py-0 text-right align-top text-fg-subtle">
                      {i + 1}
                    </td>
                    <td className="w-full whitespace-pre px-3 py-0 align-top text-fg">
                      {line || " "}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </code>
        </pre>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
