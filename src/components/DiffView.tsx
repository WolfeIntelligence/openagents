import { highlight, resolveLanguage, type Token, type TokenType } from "@/lib/highlight";
import type { DiffLine, Hunk } from "@/lib/diff";
import type { FileDiffEntry } from "@/lib/packageDiff";

// Same palette as `CodeBlock` (kept local rather than exported/shared — it's
// five lines and CodeBlock doesn't currently export it).
const TOKEN_CLASSES: Record<TokenType, string> = {
  keyword: "text-sky-600 dark:text-sky-400",
  string: "text-emerald-600 dark:text-emerald-400",
  comment: "text-fg-subtle italic",
  number: "text-amber-600 dark:text-amber-400",
  plain: "",
};

const STATUS_LABEL: Record<FileDiffEntry["status"], string> = {
  added: "Added",
  removed: "Removed",
  modified: "Modified",
  unchanged: "Unchanged",
};

const STATUS_CLASSES: Record<FileDiffEntry["status"], string> = {
  added: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  removed: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  modified: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  unchanged: "border-border text-fg-subtle",
};

function languageFor(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return undefined;
  return resolveLanguage(filePath.slice(dot + 1));
}

function renderTokens(tokens: Token[]) {
  return tokens.map((token, i) =>
    !TOKEN_CLASSES[token.type] ? (
      token.value
    ) : (
      <span key={i} className={TOKEN_CLASSES[token.type]}>
        {token.value}
      </span>
    )
  );
}

function LineTokens({ text, language }: { text: string; language?: string }) {
  const tokens = highlight(text, language)[0] ?? [];
  return <>{tokens.length === 0 ? " " : renderTokens(tokens)}</>;
}

const LINE_BG: Record<DiffLine["type"], string> = {
  "+": "bg-emerald-50 dark:bg-emerald-950/40",
  "-": "bg-red-50 dark:bg-red-950/40",
  " ": "",
};

/** Unified (single-column) rendering of one hunk's lines. */
function UnifiedHunk({ hunk, language }: { hunk: Hunk; language?: string }) {
  return (
    <table className="w-full border-collapse text-xs">
      <tbody>
        {hunk.lines.map((line, i) => (
          <tr key={i} className={LINE_BG[line.type]}>
            <td className="w-6 select-none px-2 text-center font-mono text-fg-subtle">
              {line.type === " " ? "" : line.type}
            </td>
            <td className="whitespace-pre px-2 py-0 font-mono">
              <LineTokens text={line.text} language={language} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Pairs a hunk's `+`/`-` lines side by side (GitHub-style split diff): a run
 *  of deletes is zipped against the following run of inserts index-by-index,
 *  padding the shorter side with a blank cell. Context (` `) lines appear
 *  identically on both sides. */
function pairHunkLines(lines: DiffLine[]): { left?: DiffLine; right?: DiffLine }[] {
  const pairs: { left?: DiffLine; right?: DiffLine }[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === " ") {
      pairs.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    while (i < lines.length && lines[i].type === "-") {
      dels.push(lines[i]);
      i++;
    }
    const ins: DiffLine[] = [];
    while (i < lines.length && lines[i].type === "+") {
      ins.push(lines[i]);
      i++;
    }
    const max = Math.max(dels.length, ins.length);
    for (let j = 0; j < max; j++) {
      pairs.push({ left: dels[j], right: ins[j] });
    }
  }
  return pairs;
}

function SplitHunk({ hunk, language }: { hunk: Hunk; language?: string }) {
  const pairs = pairHunkLines(hunk.lines);
  return (
    <table className="w-full table-fixed border-collapse text-xs">
      <tbody>
        {pairs.map((pair, i) => (
          <tr key={i}>
            <td className={`w-1/2 whitespace-pre px-2 py-0 font-mono ${pair.left ? LINE_BG[pair.left.type] : ""}`}>
              {pair.left ? <LineTokens text={pair.left.text} language={language} /> : ""}
            </td>
            <td className={`w-1/2 whitespace-pre px-2 py-0 font-mono ${pair.right ? LINE_BG[pair.right.type] : ""}`}>
              {pair.right ? <LineTokens text={pair.right.text} language={language} /> : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FileDiffBlock({ file, view }: { file: FileDiffEntry; view: "split" | "unified" }) {
  const language = languageFor(file.path);
  const isChanged = file.status !== "unchanged";

  return (
    <details
      open={isChanged}
      className="overflow-hidden rounded-lg border border-border"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 bg-surface px-4 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-fg-subtle">
          &#9656;
        </span>
        <span className="truncate font-mono text-fg">{file.path}</span>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_CLASSES[file.status]}`}
        >
          {STATUS_LABEL[file.status]}
        </span>
        {file.encoding === "base64" ? (
          <span className="text-xs text-fg-subtle">binary</span>
        ) : (
          (file.additions > 0 || file.deletions > 0) && (
            <span className="ml-auto flex items-center gap-2 font-mono text-xs">
              {file.additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>}
              {file.deletions > 0 && <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>}
            </span>
          )
        )}
      </summary>

      {file.encoding === "base64" ? (
        <p className="border-t border-border px-4 py-3 text-xs text-fg-subtle">
          Binary file {file.status === "unchanged" ? "unchanged" : file.status}. Binary contents aren&apos;t diffed.
        </p>
      ) : file.status === "unchanged" ? (
        <p className="border-t border-border px-4 py-3 text-xs text-fg-subtle">No changes in this file.</p>
      ) : !file.hunks ? (
        <p className="border-t border-border px-4 py-3 text-xs text-fg-subtle">
          Diff too large to display — {file.additions} addition{file.additions === 1 ? "" : "s"}, {file.deletions}{" "}
          deletion{file.deletions === 1 ? "" : "s"}.
        </p>
      ) : (
        <div className="divide-y divide-border border-t border-border">
          {file.hunks.map((hunk, i) => (
            <div key={i} className="overflow-x-auto">
              <div className="bg-surface px-2 py-1 font-mono text-[10px] text-fg-subtle">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              {view === "split" ? (
                <SplitHunk hunk={hunk} language={language} />
              ) : (
                <UnifiedHunk hunk={hunk} language={language} />
              )}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

export function DiffView({ files, view }: { files: FileDiffEntry[]; view: "split" | "unified" }) {
  if (files.length === 0) {
    return <p className="text-sm text-fg-muted">These versions have no files to compare.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {files.map((file) => (
        <FileDiffBlock key={file.path} file={file} view={view} />
      ))}
    </div>
  );
}
