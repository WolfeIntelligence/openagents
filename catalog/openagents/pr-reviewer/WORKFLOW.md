# PR Reviewer — Workflow

A structured procedure for reviewing a pull request the way a careful senior engineer
would: gather full context first, classify risk before reading line-by-line, work a
fixed checklist, and report findings in a consistent, severity-tagged format instead of
a stream-of-consciousness comment.

Inputs: `pr_ref` (required), `base_ref` (default `main`), `post_comments` (default `false`).

## Step 1 — Gather context

Do not start reading the diff yet. First collect:

1. **The diff itself.**
   - GitHub PR: `gh pr diff <pr_ref>` (also `gh pr view <pr_ref> --json title,body,files,additions,deletions`).
   - Local branch/range: `git diff <base_ref>...<pr_ref>` (three-dot = changes since merge-base).
2. **The PR description / linked issue.** Understand *why* this change exists before
   judging *how* it was made. A 400-line diff with a one-line "fixes bug" description is
   itself a finding (see Step 2).
3. **The file list with change size**, not just the diff text: `git diff --stat`. This
   tells you where to spend attention — a 3-line config tweak and a 300-line new module
   deserve very different scrutiny.
4. **CI status.** If checks are failing, note it up front; don't duplicate what a linter
   or test runner already caught.
5. **Blast radius.** Grep for callers/importers of any changed public function, exported
   type, API route, or schema. A correct-looking change can still break callers that
   assumed the old contract.

## Step 2 — Classify risk

Before checklist review, assign an overall risk tier. This sets how much scrutiny to
apply and belongs at the top of the final report.

| Tier | Criteria (any one qualifies) |
|------|-------------------------------|
| **High** | Touches auth/authz, payments, data deletion, migrations, crypto, secrets handling, or public API contracts; >400 lines changed; touches CI/deploy config |
| **Medium** | New business logic, non-trivial refactor, touches shared/widely-imported code, adds a new dependency |
| **Low** | Docs, tests-only, comments, formatting, isolated/leaf-module changes, config value tweaks with no behavior change |

Also flag **scope mismatch** here: if the PR description says "fix typo" but the diff
touches auth middleware, that mismatch is itself a High-severity finding — surprise
scope is a red flag independent of whether the code is correct.

## Step 3 — Work the checklist

Apply `rules/review-checklist.md` in order: correctness, security, tests, performance.
Do not skip categories because the PR "looks like" a docs change — a docs-only diff can
still leak an internal hostname or credential. For each checklist item that finds
something, record: file:line, what's wrong, why it matters, and a concrete suggested
fix (not just "this looks off"). If a checklist item is genuinely not applicable (e.g.
no SQL in a frontend-only PR), skip it silently rather than padding the report.

## Step 4 — Verify tests actually exercise the change

Don't just check "tests were added" as a checkbox. For each new/changed behavior:
- Find the test that covers it and confirm the assertion would actually fail if the
  behavior regressed (not just "the function was called").
- Check the diff for tests that were *weakened* to make CI pass (loosened assertions,
  increased timeouts, skipped/`.only`'d tests, removed edge cases).
- For bug fixes, confirm there's a regression test reproducing the original bug.

## Step 5 — Compose the report

Use `templates/review-comment.md`. Order findings by severity (blocker → major → minor
→ nit), each with file:line and a suggested fix. Lead with the risk tier from Step 2
and a one-paragraph summary of what the PR does and whether it should merge as-is,
merge with changes, or needs a design discussion first.

Do not manufacture findings to look thorough — "no issues found in this category" is a
valid and useful line. Nits (style, naming, minor readability) go at the bottom and
should be clearly optional; never block a PR on nits alone.

## Step 6 — Deliver

- If `post_comments` is `false` (default): print the report and stop. This is the safe
  default — do not post anything.
- If `post_comments` is `true`: this is a side-effectful, externally-visible action.
  Confirm with the user which specific comments will be posted before submitting
  (`gh pr comment` / `gh pr review`), and never post secrets, internal URLs, or anything
  copied verbatim from private context into a public PR thread.

## Stop conditions

- Diff is empty or `pr_ref` doesn't resolve → report the error, do not guess.
- Diff exceeds ~2000 changed lines → say so explicitly and either review in per-file
  batches or ask the user to scope the review (e.g. to specific files/directories)
  rather than silently skimming.
- Binary files or generated/vendored files (lockfiles, `dist/`, minified bundles) in the
  diff → skip them, note that they were skipped and why.
