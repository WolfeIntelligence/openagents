# PR Reviewer

A structured pull-request review workflow. Instead of an unstructured "look over this
diff" pass, the agent gathers full context, assigns a risk tier, works a fixed
correctness/security/tests/performance checklist, and reports findings in a
severity-tagged format (blocker / major / minor / nit) with file:line references and
concrete fixes.

## When to use

- Before merging any non-trivial PR, especially ones touching auth, payments, public
  APIs, or shared/widely-imported code.
- As a first pass before a human review, to surface the mechanical issues (missing
  edge cases, weak tests, injection risks) so the human reviewer can focus on design
  and product judgment.
- On your own PRs before requesting review, to catch obvious issues early.

Not a replacement for architectural/design review — it reviews the diff in front of
it, not whether the feature should exist.

## Install

```bash
npx openagents add openagents/pr-reviewer
```

Or pick a runtime explicitly:

```bash
npx openagents add openagents/pr-reviewer --runtime claude-code
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/pr-reviewer/` |
| `cursor` | `.cursor/rules/pr-reviewer/` |
| `codex` | `.codex/skills/pr-reviewer/` |
| `generic` | `.openagents/pr-reviewer/` |

## Inputs

| name | type | required | default | description |
|---|---|---|---|---|
| `pr_ref` | string | yes | — | PR number, branch name, or commit range (e.g. `123`, `feature/x`, `main..HEAD`) |
| `base_ref` | string | no | `main` | Base branch/ref to diff against |
| `post_comments` | boolean | no | `false` | Post inline comments to the PR instead of just printing a report |

## Example run

```
> Review PR #482 against main. Don't post comments, just give me the report.
```

The agent will:
1. Run `gh pr diff 482` and `gh pr view 482 --json title,body,files` for context.
2. Classify the PR as High/Medium/Low risk (e.g. High — touches `src/auth/session.ts`).
3. Work the checklist in `rules/review-checklist.md`.
4. Verify new tests actually exercise the changed behavior.
5. Print a report using `templates/review-comment.md`, ordered blocker → nit.

## Files

- `WORKFLOW.md` — the step-by-step procedure (entry point).
- `rules/review-checklist.md` — the correctness/security/tests/performance checklist.
- `templates/review-comment.md` — output format and severity definitions.

## Limitations

- Requires the `gh` CLI (or equivalent git/platform access) to fetch PR diffs and
  metadata; without it, supply a local `git diff` range instead.
- Does not run the test suite or a security scanner itself — it reads code, it doesn't
  execute it. Pair with your CI for dynamic checks (fuzzing, SAST, dependency audits).
- Large diffs (2000+ changed lines) are flagged rather than silently reviewed in full;
  scope the review to specific files/directories for best results.
- `post_comments: true` is a side-effectful action — the workflow always confirms the
  exact comments before posting.
