// Dependency-free line diff (Z3) — Myers' O(ND) shortest-edit-script
// algorithm (https://neil.fraser.name/writing/diff/myers.pdf), hand-rolled
// because no diffing library is a project dependency (AGENTS.md). Pure and
// side-effect-free: no `next/server`, no DB, safe to unit test directly with
// `node:test` (see `./__tests__/diff.test.ts`) and safe to import from both
// the version-diff API route and the compare page.

export type DiffLineType = " " | "+" | "-";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface LineDiffResult {
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

/** Lines of leading/trailing context kept around a change when grouping into
 *  hunks — matches the conventional unified-diff default. */
export const DEFAULT_CONTEXT_LINES = 3;

/**
 * Hard cap on the edit distance (`d`) the Myers search will explore before
 * giving up. The algorithm is O(N*D) in time and space, where D is the
 * number of differing lines — two large, almost entirely different files
 * would otherwise make D approach N+M and blow up CPU/memory on a request
 * thread. Comfortably above any real single-file diff a package is likely to
 * contain; past it, `diffLines` degrades to a "whole file replaced" result
 * (every old line removed, every new line added) rather than hanging.
 */
const MAX_EDIT_DISTANCE = 20_000;

/** Splits text into lines without manufacturing a phantom trailing empty line
 *  for a trailing newline — `"a\nb\n"` is two lines, not three. An empty
 *  string is zero lines. */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTrailingNewline.split("\n");
}

type EditOp =
  | { type: "equal"; aIndex: number; bIndex: number }
  | { type: "delete"; aIndex: number }
  | { type: "insert"; bIndex: number };

/** Full-replace fallback used both when the edit distance exceeds
 *  `MAX_EDIT_DISTANCE` and as the trivial answer when either side is empty. */
function replaceAll(a: string[], b: string[]): EditOp[] {
  const ops: EditOp[] = [];
  for (let i = 0; i < a.length; i++) ops.push({ type: "delete", aIndex: i });
  for (let j = 0; j < b.length; j++) ops.push({ type: "insert", bIndex: j });
  return ops;
}

/**
 * Myers' shortest-edit-script search + backtrack, adapted from the reference
 * algorithm (search phase records a `trace` of the `v` array at each `d`;
 * backtrack walks that trace from the end to recover the path in file
 * order). Returns ops in file order, ready to render as a diff.
 */
function shortestEditScript(a: string[], b: string[]): EditOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((_, j): EditOp => ({ type: "insert", bIndex: j }));
  if (m === 0) return a.map((_, i): EditOp => ({ type: "delete", aIndex: i }));

  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  let v: Record<number, number> = { 1: 0 };
  const trace: Record<number, number>[] = [];
  let found = false;
  let dFound = 0;

  outer: for (let d = 0; d <= max; d++) {
    trace.push({ ...v });
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[k - 1] ?? -Infinity) < (v[k + 1] ?? -Infinity))) {
        x = v[k + 1];
      } else {
        x = v[k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k] = x;
      if (x >= n && y >= m) {
        found = true;
        dFound = d;
        break outer;
      }
    }
  }

  if (!found) return replaceAll(a, b);

  // Backtrack from (n, m) to (0, 0) through `trace`, in reverse-d order, to
  // recover the path; the loop pushes ops in reverse file order, hence the
  // final `.reverse()`.
  const ops: EditOp[] = [];
  let x = n;
  let y = m;
  for (let d = dFound; d >= 0; d--) {
    v = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && (v[k - 1] ?? -Infinity) < (v[k + 1] ?? -Infinity))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: "equal", aIndex: x - 1, bIndex: y - 1 });
      x--;
      y--;
    }

    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: "insert", bIndex: y - 1 });
      } else {
        ops.push({ type: "delete", aIndex: x - 1 });
      }
    }
    x = prevX;
    y = prevY;
  }

  return ops.reverse();
}

/**
 * Diffs two whole-file texts and groups the result into unified-diff-style
 * hunks with `contextLines` of untouched context on each side (adjacent
 * change runs separated by a small-enough gap of unchanged lines are merged
 * into one hunk, same as `diff -U`). Returns no hunks — and zero
 * additions/deletions — for identical inputs (including both empty).
 */
export function diffLines(
  oldText: string,
  newText: string,
  contextLines: number = DEFAULT_CONTEXT_LINES
): LineDiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = shortestEditScript(a, b);

  const lines: DiffLine[] = [];
  const oldLineBefore: number[] = [];
  const newLineBefore: number[] = [];
  let oldCount = 0;
  let newCount = 0;
  let additions = 0;
  let deletions = 0;

  for (const op of ops) {
    oldLineBefore.push(oldCount);
    newLineBefore.push(newCount);
    if (op.type === "equal") {
      lines.push({ type: " ", text: a[op.aIndex] });
      oldCount++;
      newCount++;
    } else if (op.type === "delete") {
      lines.push({ type: "-", text: a[op.aIndex] });
      oldCount++;
      deletions++;
    } else {
      lines.push({ type: "+", text: b[op.bIndex] });
      newCount++;
      additions++;
    }
  }

  const changedIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== " ") changedIndices.push(i);
  }

  if (changedIndices.length === 0) {
    return { hunks: [], additions: 0, deletions: 0 };
  }

  // Cluster change-run indices into hunks: consecutive changed lines
  // separated by a run of unchanged lines short enough to just show as
  // context (<= 2*contextLines) get merged into a single hunk instead of
  // fragmenting into several tiny ones.
  const groups: [number, number][] = [];
  let groupStart = changedIndices[0];
  let groupEnd = changedIndices[0];
  for (let idx = 1; idx < changedIndices.length; idx++) {
    const cur = changedIndices[idx];
    if (cur - groupEnd - 1 <= 2 * contextLines) {
      groupEnd = cur;
    } else {
      groups.push([groupStart, groupEnd]);
      groupStart = cur;
      groupEnd = cur;
    }
  }
  groups.push([groupStart, groupEnd]);

  const hunks: Hunk[] = groups.map(([gs, ge]) => {
    const lo = Math.max(0, gs - contextLines);
    const hi = Math.min(lines.length - 1, ge + contextLines);
    const slice = lines.slice(lo, hi + 1);

    const hunkOldLines = slice.filter((l) => l.type !== "+").length;
    const hunkNewLines = slice.filter((l) => l.type !== "-").length;
    const oldStart = hunkOldLines > 0 ? oldLineBefore[lo] + 1 : oldLineBefore[lo];
    const newStart = hunkNewLines > 0 ? newLineBefore[lo] + 1 : newLineBefore[lo];

    return {
      oldStart,
      oldLines: hunkOldLines,
      newStart,
      newLines: hunkNewLines,
      lines: slice,
    };
  });

  return { hunks, additions, deletions };
}
