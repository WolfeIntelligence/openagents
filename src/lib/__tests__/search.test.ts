// Run via `npm test` (node --import tsx --test) or `npx tsx --test <this file>`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  escapeLike,
  matchesTerms,
  rankByQuery,
  scoreDocument,
  isWithinOneEdit,
  buildVocabulary,
  correctTerm,
  buildCorrectedQuery,
  requiredMatches,
} from "../search";

describe("tokenize", () => {
  test("trims, splits on whitespace, and lowercases", () => {
    assert.deepEqual(tokenize("  Code   Review  "), ["code", "review"]);
  });

  test("drops empty terms produced by repeated whitespace", () => {
    assert.deepEqual(tokenize("a\t\n  b"), ["a", "b"]);
  });

  test("returns an empty array for blank input", () => {
    assert.deepEqual(tokenize(""), []);
    assert.deepEqual(tokenize("   "), []);
  });

  test("caps at 8 terms", () => {
    const q = Array.from({ length: 12 }, (_, i) => `t${i}`).join(" ");
    const terms = tokenize(q);
    assert.equal(terms.length, 8);
    assert.deepEqual(terms, ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
  });
});

describe("escapeLike", () => {
  test("escapes backslash, percent, and underscore", () => {
    assert.equal(escapeLike("50%_off\\path"), "50\\%\\_off\\\\path");
  });

  test("leaves ordinary characters untouched", () => {
    assert.equal(escapeLike("code-review 2"), "code-review 2");
  });

  test("db.ts's ilike() emits no explicit ESCAPE clause, relying on Postgres's default backslash escape", async () => {
    // db.ts builds patterns as `%${escapeLike(term)}%` and passes them straight
    // to Drizzle's `ilike()`. That only neutralizes a literal `%`/`_` if
    // Postgres treats `\` as the escape character with no `ESCAPE` clause in
    // the query — which is its documented default. Confirm Drizzle doesn't
    // quietly add its own ESCAPE override that would change that.
    const { ilike, sql } = await import("drizzle-orm");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const column = sql.raw("packages.title");
    const { sql: generated, params } = dialect.sqlToQuery(ilike(column, `%${escapeLike("50%_off")}%`));
    assert.match(generated, /ilike \$1/i);
    assert.doesNotMatch(generated, /escape/i);
    assert.deepEqual(params, ["%50\\%\\_off%"]);
  });
});

describe("matchesTerms", () => {
  test("empty terms always match", () => {
    assert.equal(matchesTerms([], []), true);
  });

  test("every term must match at least one field (AND across terms)", () => {
    const fields = ["Pull Request Reviewer", "reviews PRs for style and correctness", "openagents", "code-review", "workflow"];
    assert.equal(matchesTerms(["code", "review"], fields), true);
    assert.equal(matchesTerms(["code", "nonexistent"], fields), false);
  });

  test("a term can match any single field (OR within a term)", () => {
    const fields = ["title", "summary", "changelog-owner", "tag-one"];
    assert.equal(matchesTerms(["owner"], fields), true);
  });

  test("is case-insensitive", () => {
    assert.equal(matchesTerms(["REVIEW"], ["code-review"]), true);
  });

  test("hyphen in a tag counts as a separator (B9c multi-word example)", () => {
    // The audit's own example: q="code review" must find openagents/pr-reviewer
    // whose tags include "code-review" and title is "Pull Request Reviewer".
    const fields = ["Pull Request Reviewer", "reviews pull requests", "openagents", "code-review"];
    assert.equal(matchesTerms(tokenize("code review"), fields), true);
  });

  test("substring match still works without a hyphen boundary", () => {
    assert.equal(matchesTerms(["code"], ["encoded"]), true);
  });
});

describe("rankByQuery", () => {
  const item = (name: string, title: string, updatedAt: string) => ({ name, title, updatedAt });

  test("returns items unchanged when there are no terms", () => {
    const items = [item("b", "B", "2020-01-01"), item("a", "A", "2020-01-02")];
    assert.deepEqual(rankByQuery(items, []), items);
  });

  test("an exact name match ranks first", () => {
    const items = [
      item("other-tool", "Other Tool", "2026-01-05"),
      item("pr-reviewer", "Pull Request Reviewer", "2020-01-01"),
    ];
    const ranked = rankByQuery(items, ["pr-reviewer"]);
    assert.equal(ranked[0].name, "pr-reviewer");
  });

  test("name/title contains ranks above items that only matched elsewhere", () => {
    const items = [
      item("unrelated", "Unrelated Package", "2026-01-05"), // most recent, but not a name/title hit
      item("pr-reviewer", "Pull Request Reviewer", "2020-01-01"), // title contains "review"
    ];
    const ranked = rankByQuery(items, ["review"]);
    assert.equal(ranked[0].name, "pr-reviewer");
  });

  test("ties within a tier break by updatedAt descending", () => {
    const items = [
      item("alpha-review", "Alpha Review", "2020-01-01"),
      item("beta-review", "Beta Review", "2024-06-01"),
    ];
    const ranked = rankByQuery(items, ["review"]);
    assert.deepEqual(ranked.map((i) => i.name), ["beta-review", "alpha-review"]);
  });

  test("does not mutate the input array", () => {
    const items = [item("b", "B", "2020-01-01"), item("a-exact", "A", "2024-01-01")];
    const copy = [...items];
    rankByQuery(items, ["a-exact"]);
    assert.deepEqual(items, copy);
  });
});

describe("scoreDocument (G-S1)", () => {
  const doc = (over: Partial<Parameters<typeof scoreDocument>[1]> = {}) => ({
    name: "pr-reviewer",
    title: "Pull Request Reviewer",
    updatedAt: "2020-01-01",
    summary: "reviews pull requests for style and correctness",
    tags: ["code-review", "github"],
    owner: "openagents",
    ...over,
  });

  test("no terms scores zero", () => {
    assert.equal(scoreDocument([], doc()), 0);
  });

  test("an exact full-name match outscores everything else", () => {
    const exact = scoreDocument(["pr-reviewer"], doc());
    const substringOnly = scoreDocument(["pr-reviewer"], doc({ name: "other", title: "Other", tags: [] }));
    assert.ok(exact > substringOnly);
  });

  test("a name-prefix match outscores a title-word match", () => {
    const prefix = scoreDocument(["pr"], doc({ name: "pr-reviewer" }));
    const titleWordOnly = scoreDocument(["reviewer"], doc({ name: "something-else" }));
    assert.ok(prefix > titleWordOnly);
  });

  test("a whole-word tag match scores higher than a bare substring hit", () => {
    const wholeWord = scoreDocument(["review"], doc({ name: "x", title: "X", tags: ["code-review"] }));
    const substringOnly = scoreDocument(["revie"], doc({ name: "x", title: "X", tags: ["code-review"] }));
    assert.ok(wholeWord > substringOnly);
  });

  test("scores sum across multiple matching terms", () => {
    const oneTerm = scoreDocument(["review"], doc());
    const twoTerms = scoreDocument(["review", "github"], doc());
    assert.ok(twoTerms > oneTerm);
  });

  test("missing summary/tags/owner are treated as empty, not an error", () => {
    assert.doesNotThrow(() => scoreDocument(["review"], { name: "a", title: "B", updatedAt: "2020-01-01" }));
  });
});

describe("isWithinOneEdit", () => {
  test("identical strings are within one edit", () => {
    assert.equal(isWithinOneEdit("review", "review"), true);
  });

  test("a single substitution is within one edit", () => {
    assert.equal(isWithinOneEdit("reviw", "revie"), true); // w<->e substitution, same length
  });

  test("a single insertion/deletion is within one edit", () => {
    assert.equal(isWithinOneEdit("revie", "review"), true); // deletion of trailing "w"
    assert.equal(isWithinOneEdit("reviewx", "review"), true); // insertion of trailing "x"
  });

  test("an adjacent transposition is within one edit", () => {
    assert.equal(isWithinOneEdit("reveiw", "review"), true); // "ei" <-> "ie"
  });

  test("two non-adjacent substitutions are not within one edit", () => {
    assert.equal(isWithinOneEdit("aabbcc", "aabbdd"), false); // differs at both trailing chars
    assert.equal(isWithinOneEdit("axbxcx", "aybycy"), false); // differs in 3 places
  });

  test("lengths differing by more than one are never within one edit", () => {
    assert.equal(isWithinOneEdit("review", "re"), false);
  });
});

describe("buildVocabulary", () => {
  test("splits names and tags on hyphens, lowercases, and dedupes", () => {
    const vocab = buildVocabulary([
      { name: "pr-reviewer", tags: ["code-review", "Review"] },
      { name: "changelog-generator", tags: ["review"] },
    ]);
    assert.ok(vocab.includes("pr"));
    assert.ok(vocab.includes("reviewer"));
    assert.ok(vocab.includes("code"));
    assert.ok(vocab.includes("review"));
    assert.equal(vocab.filter((w) => w === "review").length, 1); // deduped
  });
});

describe("correctTerm / buildCorrectedQuery (G-S1 typo tolerance)", () => {
  const vocabulary = ["review", "reviewer", "changelog", "generator", "security"];

  test("corrects a term with one edit against the vocabulary", () => {
    assert.equal(correctTerm("reveiw", vocabulary), "review"); // transposition
    assert.equal(correctTerm("reviey", vocabulary), "review"); // substitution
  });

  test("never corrects a term shorter than 5 characters", () => {
    assert.equal(correctTerm("scan", ["scam", "span"]), null);
  });

  test("does not correct a term that's already in the vocabulary", () => {
    assert.equal(correctTerm("review", vocabulary), null);
  });

  test("returns null when nothing in the vocabulary is close enough", () => {
    assert.equal(correctTerm("xxxxxxxxxx", vocabulary), null);
  });

  test("buildCorrectedQuery only reports a change when something was actually corrected", () => {
    const unchanged = buildCorrectedQuery(["review"], vocabulary);
    assert.equal(unchanged.correctedQuery, null);
    assert.deepEqual(unchanged.terms, ["review"]);

    const changed = buildCorrectedQuery(["reveiw"], vocabulary);
    assert.equal(changed.correctedQuery, "review");
    assert.deepEqual(changed.terms, ["review"]);
  });

  test("corrects only the terms that need it, leaving the rest untouched", () => {
    const result = buildCorrectedQuery(["changelog", "reveiw"], vocabulary);
    assert.equal(result.correctedQuery, "changelog review");
  });
});


test("matchesTerms: long queries only need most terms (over-specified searches keep the best match)", () => {
  const migrationReview = ["db-migration-review", "Migration Review", "Review a schema migration before it runs", "openagents", "database", "migrations", "review"];
  // only "migration" is present of the three → not a hit
  assert.equal(matchesTerms(["sql", "migration", "safety"], migrationReview), false);
  assert.equal(requiredMatches(1), 1);
  assert.equal(requiredMatches(2), 2);
  assert.equal(requiredMatches(3), 2);
  assert.equal(requiredMatches(5), 3);
  // two of three terms present → still a hit
  assert.equal(matchesTerms(["migration", "review", "safety"], migrationReview), true);
  // only one of three → not a hit
  assert.equal(matchesTerms(["sql", "safety", "locks"], migrationReview), false);
});
