import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { listVersions } from "@/lib/catalog/versions";
import { auth } from "@/lib/auth";
import { buildVersionDiff } from "@/lib/packageDiff";
import { DiffView } from "@/components/DiffView";
import { CompareControls } from "./CompareControls";

type Params = { owner: string; name: string };
type CompareSearchParams = { from?: string; to?: string; view?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { owner, name } = await params;
  return { title: `Compare versions · ${owner}/${name}` };
}

/** Picks the default "from" version relative to `to` in `versions`
 *  (newest-first, per `listVersions`): the version immediately before it
 *  chronologically. If `to` is already the oldest published version (no
 *  older one to fall back to), compares against the next-newest instead —
 *  still shows a real diff rather than comparing a version to itself. */
function defaultFrom(versions: { version: string }[], toIndex: number): string {
  return versions[toIndex + 1]?.version ?? versions[toIndex - 1]?.version ?? versions[toIndex].version;
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<CompareSearchParams>;
}) {
  const { owner, name } = await params;
  const { from: fromQ, to: toQ, view: viewQ } = await searchParams;

  const versions = await listVersions(owner, name); // newest-first
  if (versions.length === 0) notFound();

  const to = toQ && versions.some((v) => v.version === toQ) ? toQ : versions[0].version;
  const toIndex = versions.findIndex((v) => v.version === to);
  const from = fromQ && versions.some((v) => v.version === fromQ) ? fromQ : defaultFrom(versions, toIndex);
  const view: "split" | "unified" = viewQ === "split" ? "split" : "unified";

  const session = await auth();
  const outcome = await buildVersionDiff(owner, name, to, from, session);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm">
        <Link href={`/p/${owner}/${name}`} className="font-mono text-fg-muted hover:text-fg">
          {owner}/{name}
        </Link>
        <span className="text-fg-subtle">/</span>
        <span className="text-fg" aria-current="page">
          Compare
        </span>
      </nav>

      <div className="border-b border-border pb-4">
        <h1 className="text-xl font-semibold text-fg">Compare versions</h1>
        {versions.length < 2 && (
          <p className="mt-1 text-sm text-fg-muted">
            This package has only one published version — nothing to compare yet.
          </p>
        )}
      </div>

      <div className="mt-4">
        <CompareControls owner={owner} name={name} versions={versions} from={from} to={to} view={view} />
      </div>

      <div className="mt-6">
        {!outcome.ok ? (
          outcome.status === 402 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
              <p className="max-w-sm text-sm text-fg-muted">
                This is a paid package. Buy it to compare versions and read the full source.
              </p>
              <Link
                href={`/p/${owner}/${name}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:border-border-strong"
              >
                Back to {owner}/{name}
              </Link>
            </div>
          ) : (
            notFound()
          )
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-fg-subtle">
              <span>
                <span className="font-mono text-fg">v{from}</span> &rarr;{" "}
                <span className="font-mono text-fg">v{to}</span>
              </span>
              <span>{outcome.result.summary.added} added</span>
              <span>{outcome.result.summary.modified} modified</span>
              <span>{outcome.result.summary.removed} removed</span>
              {outcome.result.truncated && (
                <span className="text-warning">Diff truncated — some large files aren&apos;t shown in full.</span>
              )}
            </div>
            <DiffView files={outcome.result.files} view={view} />
          </>
        )}
      </div>
    </div>
  );
}
