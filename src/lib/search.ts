// Shared search primitives used by both catalog implementations (seed.ts's
// in-memory filter and db.ts's SQL `WHERE` builder), so the two stay
// behaviourally identical for the same query. See docs/AUDIT-2026-09.md B9a-c.

/**
 * Splits a raw `q` into lowercase search terms: trim, split on whitespace,
 * drop empties, cap at 8 terms (a defensive limit — nobody legitimately
 * searches on 30 words, and it bounds the AND-chain built in `db.ts`).
 */
export function tokenize(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase())
    .slice(0, 8);
}

/**
 * Escapes the three characters that are special inside a Postgres LIKE/ILIKE
 * pattern — `\`, `%`, `_` — so a literal `%` or `_` typed by a user is matched
 * literally rather than treated as a wildcard. Postgres's LIKE/ILIKE default
 * escape character is the backslash (no explicit `ESCAPE '\'` needed), and
 * Drizzle's `ilike()` passes the pattern through as a bound parameter with no
 * escape override — see `src/lib/__tests__/search.test.ts` for a check against
 * the actual generated SQL.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * True when every term matches (case-insensitive substring) at least one of
 * the given fields — the in-memory equivalent of the AND-of-ORs `WHERE`
 * built in `db.ts`. A hyphen in a field is also treated as a separator (so a
 * "code-review" tag matches the term "review" from `q=code review`) by also
 * comparing the hyphen-to-space form of each field.
 */
export function matchesTerms(terms: string[], fields: string[]): boolean {
  if (terms.length === 0) return true;
  const normalized: string[] = [];
  for (const field of fields) {
    const lower = field.toLowerCase();
    normalized.push(lower);
    const spaced = lower.replace(/-/g, " ");
    if (spaced !== lower) normalized.push(spaced);
  }
  // Terms are lowercased here too (not just trusted to already be, e.g. from
  // `tokenize`) so this stays correct for any caller.
  return terms.every((term) => {
    const lower = term.toLowerCase();
    return normalized.some((field) => field.includes(lower));
  });
}

/** The subset of `PackageSummary` that ranking needs — kept minimal so this
 *  module doesn't have to import `./types` and can be used from either catalog. */
export interface RankableSummary {
  name: string;
  title: string;
  updatedAt: string; // ISO
}

/**
 * Orders search results the way a user expects: an exact name match first,
 * then anything whose name or title contains a term, then everything else
 * that matched only on summary/owner/tags — ties broken by most-recently
 * updated. Used by both catalogs' `list()` (when `q` is present and no
 * explicit `sort` was requested) and by `withStats` when it re-sorts a
 * `downloads`/`stars` page, so the tiering logic lives in exactly one place.
 *
 * Stable and non-mutating: callers that need the original array untouched
 * (e.g. re-sorting a page in place) get a new array back.
 */
export function rankByQuery<T extends RankableSummary>(items: T[], terms: string[]): T[] {
  if (terms.length === 0) return items;
  const joinedSpace = terms.join(" ");
  const joinedHyphen = terms.join("-");

  const tier = (item: T): 0 | 1 | 2 => {
    const name = item.name.toLowerCase();
    const title = item.title.toLowerCase();
    if (name === joinedSpace || name === joinedHyphen) return 0;
    if (terms.some((term) => name.includes(term) || title.includes(term))) return 1;
    return 2;
  };

  return [...items].sort((a, b) => {
    const diff = tier(a) - tier(b);
    if (diff !== 0) return diff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}
