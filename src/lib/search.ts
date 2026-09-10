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
 *  module doesn't have to import `./types` and can be used from either catalog.
 *  `summary`/`tags`/`owner` are optional so callers (and tests) that only have
 *  a name/title/updatedAt still satisfy this interface; `scoreDocument` just
 *  treats a missing field as empty. */
export interface RankableSummary {
  name: string;
  title: string;
  updatedAt: string; // ISO
  summary?: string;
  tags?: string[];
  owner?: string;
}

/** Per-term score weights, highest signal first (G-S1). Chosen so a single
 *  strong signal (an exact name match) always outranks any number of weak
 *  ones (plain substring hits) without needing a second sort key. */
const SCORE = {
  exactName: 1000,
  namePrefix: 500,
  titleWord: 100,
  summaryOrTagWord: 50,
  substring: 10,
} as const;

/** Splits on whitespace *and* hyphens — used to test for a whole-word match
 *  (as opposed to a bare substring) inside a title or tag list, so "review"
 *  matches the word "review" in "code-review" but "vie" does not. */
function words(text: string): string[] {
  return text.toLowerCase().split(/[\s-]+/).filter(Boolean);
}

/**
 * Scores how well a document matches a set of search terms: exact name match
 * highest, then a name-prefix, then a whole-word hit in the title, then a
 * whole-word hit in the summary or tags, then a bare substring hit anywhere —
 * summed per term so a document matching more terms (or matching one term
 * more strongly) always sorts first. This is the single ranking function
 * shared by `rankByQuery` (seed and DB list ordering) so search results are
 * ordered identically in both catalog modes — see docs/AUDIT-2026-09.md G-S1.
 */
export function scoreDocument(terms: string[], doc: RankableSummary): number {
  if (terms.length === 0) return 0;
  const name = doc.name.toLowerCase();
  const title = doc.title.toLowerCase();
  const summary = (doc.summary ?? "").toLowerCase();
  const tags = (doc.tags ?? []).map((t) => t.toLowerCase());
  const owner = (doc.owner ?? "").toLowerCase();
  const titleWords = words(title);
  const tagWords = tags.flatMap(words);
  const summaryWords = words(summary);
  const tagsJoined = tags.join(" ");
  const tagsSpaced = tagsJoined.replace(/-/g, " ");

  let score = 0;
  if (name === terms.join(" ") || name === terms.join("-")) score += SCORE.exactName;

  for (const term of terms) {
    if (name.startsWith(term)) score += SCORE.namePrefix;
    if (titleWords.includes(term)) score += SCORE.titleWord;
    if (summaryWords.includes(term) || tagWords.includes(term)) score += SCORE.summaryOrTagWord;
    if (
      name.includes(term) ||
      title.includes(term) ||
      summary.includes(term) ||
      tagsJoined.includes(term) ||
      tagsSpaced.includes(term) ||
      owner.includes(term)
    ) {
      score += SCORE.substring;
    }
  }
  return score;
}

/**
 * Orders search results by `scoreDocument`, ties broken by most-recently
 * updated. Used by both catalogs' `list()` (when `q` is present and no
 * explicit `sort` was requested) and by `withStats` when it re-sorts a
 * `downloads`/`stars`/`trending` page, so the tiering logic lives in exactly
 * one place and the two catalog implementations can never drift apart.
 *
 * Stable and non-mutating: callers that need the original array untouched
 * (e.g. re-sorting a page in place) get a new array back.
 */
export function rankByQuery<T extends RankableSummary>(items: T[], terms: string[]): T[] {
  if (terms.length === 0) return items;
  return [...items].sort((a, b) => {
    const diff = scoreDocument(terms, b) - scoreDocument(terms, a);
    if (diff !== 0) return diff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

// ---------------------------------------------------------------------------
// Typo tolerance (G-S1): when a query term of 5+ characters gets zero hits,
// retry once against a corrected term found by a bounded edit-distance search
// over the catalog's own name/tag vocabulary. Deliberately conservative —
// only ever fires on a genuinely empty result, and only ever proposes a word
// that already exists in this catalog, so it can't suggest nonsense.
// ---------------------------------------------------------------------------

/** Minimum term length eligible for typo correction — short terms have too
 *  many equally-plausible one-edit neighbors to correct safely (e.g. "cat"
 *  is one edit from "car", "cot", "cats", "at", ...). */
const MIN_CORRECTABLE_LENGTH = 5;

/**
 * True when `a` and `b` are at most one Damerau-Levenshtein edit apart (an
 * insertion, deletion, substitution, or transposition of adjacent
 * characters). Only ever needs to distinguish 0/1 from "more than 1", so
 * this short-circuits on length and mismatch count rather than computing a
 * full edit-distance matrix.
 */
export function isWithinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const lenDiff = a.length - b.length;
  if (Math.abs(lenDiff) > 1) return false;

  if (lenDiff === 0) {
    // Same length: either exactly one substitution, or one adjacent transposition.
    let firstDiff = -1;
    let mismatches = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        mismatches++;
        if (firstDiff === -1) firstDiff = i;
        if (mismatches > 2) return false;
      }
    }
    if (mismatches === 0) return true; // equal (already handled above, kept for clarity)
    if (mismatches === 1) return true; // one substitution
    // Exactly two mismatched positions: a transposition only if they're
    // adjacent and swapped.
    const j = firstDiff + 1;
    return a[firstDiff] === b[j] && a[j] === b[firstDiff] && a.slice(j + 1) === b.slice(j + 1);
  }

  // Different length by exactly one: one insertion/deletion. Walk both
  // strings, allow exactly one skip on the longer side.
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

/** Builds the correction vocabulary from a catalog's own names and tags —
 *  every hyphen-separated word of each, lowercased and deduped, since those
 *  are the fields a corrected term is matched back against. */
export function buildVocabulary(docs: { name: string; tags: string[] }[]): string[] {
  const vocab = new Set<string>();
  for (const doc of docs) {
    for (const part of doc.name.toLowerCase().split("-")) if (part) vocab.add(part);
    for (const tag of doc.tags) {
      for (const part of tag.toLowerCase().split("-")) if (part) vocab.add(part);
    }
  }
  return Array.from(vocab);
}

/** Finds a same-or-shorter vocabulary word within one edit of `term`, or
 *  `null` if `term` is too short, already a real word, or has no close match.
 *  Ties break on shortest-then-alphabetical so the result is deterministic. */
export function correctTerm(term: string, vocabulary: string[]): string | null {
  if (term.length < MIN_CORRECTABLE_LENGTH) return null;
  if (vocabulary.includes(term)) return null; // it already matches something; a real bug lies elsewhere
  let best: string | null = null;
  for (const word of vocabulary) {
    if (Math.abs(word.length - term.length) > 1) continue;
    if (!isWithinOneEdit(term, word)) continue;
    if (best === null || word.length < best.length || (word.length === best.length && word < best)) {
      best = word;
    }
  }
  return best;
}

export interface CorrectedQuery {
  /** The term list to retry with — identical to the input when nothing changed. */
  terms: string[];
  /** Set only when at least one term was corrected — the string to both show
   *  the user ("Showing results for X") and re-run the search with. */
  correctedQuery: string | null;
}

/** Applies `correctTerm` to every eligible term in `terms`. Terms too short
 *  to correct, or with no close vocabulary match, pass through unchanged. */
export function buildCorrectedQuery(terms: string[], vocabulary: string[]): CorrectedQuery {
  let changed = false;
  const corrected = terms.map((term) => {
    const fix = correctTerm(term, vocabulary);
    if (fix && fix !== term) {
      changed = true;
      return fix;
    }
    return term;
  });
  return { terms: corrected, correctedQuery: changed ? corrected.join(" ") : null };
}
