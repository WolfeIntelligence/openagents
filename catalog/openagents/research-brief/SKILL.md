# Research Brief — Skill

Turns an open question into a sourced, skimmable brief: a search plan executed with
source diversity in mind, every source graded for reliability, every claim tracked
back to a specific source in a claim ledger, and the result written up with the
ledger's rigor but none of its clutter.

Inputs: `question` (required), `depth` (`quick`|`standard`|`deep`, default `standard`),
`audience` (optional, calibrates framing/technical depth).

## Step 1 — Decompose the question

Before searching, break the question into sub-questions that, together, answer it.
Example: "Should we adopt library X?" decomposes into: What does X actually do
differently from alternatives? What's its maintenance/community health? What are
known limitations/gotchas from real usage? What's the migration cost? Write these
down — they become the structure of the search plan and, later, the brief.

## Step 2 — Build the search plan

For each sub-question, plan 1-3 searches with different angles (don't just rerun the
same query worded differently):
- A direct query for the sub-question itself.
- A query aimed at finding disconfirming evidence — deliberately search for
  criticism/limitations/failure reports, not just supporting material. A brief that
  only surfaces confirming sources is not research, it's confirmation bias with
  citations.
- For time-sensitive topics, a query scoped to recent results, and note the
  freshness of what's found.

Target source count by depth: `quick` 3-5, `standard` 6-12, `deep` 12+ with deliberate
diversity across source *types* (see Step 3), not just more of the same type.

## Step 3 — Grade every source

Grade each source using `source-grading.md` before using any claim from it. Record,
per source: type (primary/secondary/tertiary), publication/author, date, and the grade.
Prefer primary sources (original docs, official announcements, the actual paper/data,
firsthand accounts) over secondary summaries when both are available — a summary can
introduce or drop nuance the brief needs.

Do not use a source's claim in the brief without recording it in the source list, even
if it "seems obviously true" — the ledger in Step 4 is what makes the brief checkable
later.

## Step 4 — Build the claim ledger

For every specific factual claim that will appear in the brief, record: the claim
itself (stated precisely, not vaguely), which source(s) support it, and — critically —
whether other sources found in Step 2 *agree*, *disagree*, or *don't address* it.

- A claim supported by only one low-graded source is weak — either find corroboration,
  soften the claim's confidence in the brief ("one report suggests..." vs. stated as
  fact), or drop it.
- A claim where sources genuinely disagree is not a bug to resolve by picking a side
  arbitrarily — the disagreement itself is often the most useful thing to report to
  the reader.
- Numbers/statistics get special scrutiny: check the original methodology when
  possible (sample size, date, what was actually measured) rather than repeating a
  number secondhand.

## Step 5 — Write the brief

Use `templates/brief.md`. Calibrate to `audience` if given — a brief for engineering
leadership can assume technical vocabulary; a brief for general readers should define
terms. Lead with the direct answer to the original `question`, then support it —
don't make the reader wait for a narrative buildup to find out the conclusion.

Every non-obvious claim in the prose carries an inline citation back to the source
list (not the raw ledger — the ledger is working material, the brief cites sources).
State confidence honestly: distinguish "well-established across multiple independent
sources" from "single source, unverified" from "sources disagree" — don't flatten
everything to the same confident tone.

## Step 6 — Self-check before delivering

- Does every claim in the brief trace to an entry in the claim ledger? Anything that
  doesn't must be either sourced or removed/flagged as the writer's own inference.
- Did the search plan actually look for disconfirming evidence (Step 2), and if it
  found any, is it represented in the brief — not just the supporting evidence?
- Is the direct answer to `question` stated plainly, near the top?
- Are dates/versions/numbers specific rather than vague ("as of [date]" not "recently")?

## Stop conditions

- Fewer than the target source count can be found after a genuine search effort
  (topic too obscure/new) → say so explicitly in the brief's confidence framing rather
  than padding with low-quality sources to hit a number.
- Sources are irreconcilably split on a load-bearing claim → present the disagreement
  and each side's basis rather than picking one arbitrarily.
- The question itself is unanswerable as posed (too vague, conflates two different
  questions) → say so and propose a decomposition rather than guessing at intent.
