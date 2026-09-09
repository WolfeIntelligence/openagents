# Commit Conventions

Standing rules for commit messages, branch names, and PR descriptions. Apply these
whenever creating a commit, branch, or PR in this repo — the goal is a git history and
PR list that's searchable and skimmable, not a formality.

## Commit message format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary, imperative mood, no trailing period>

<optional body — why, not just what, wrapped at ~72 chars>

<optional footer(s) — BREAKING CHANGE:, Fixes #123, Co-Authored-By:>
```

### Types

| type | use for |
|---|---|
| `feat` | a new feature or user-visible capability |
| `fix` | a bug fix |
| `docs` | documentation only |
| `style` | formatting, whitespace, no logic change |
| `refactor` | code change that neither fixes a bug nor adds a feature |
| `perf` | a performance improvement |
| `test` | adding or correcting tests, no production code change |
| `build` | build system, dependencies, packaging |
| `ci` | CI configuration/scripts |
| `chore` | maintenance that doesn't fit elsewhere (e.g. bumping a version) |
| `revert` | reverts a previous commit |

### Rules

- Summary line: imperative mood ("add", "fix", "remove" — not "added"/"fixes"), lower
  case after the type, no trailing period, ideally ≤ 72 characters.
- Scope (optional) is the affected area in parentheses, e.g. `feat(auth): ...`,
  `fix(billing): ...`. Omit if the change is repo-wide or scope is ambiguous.
- Body explains **why**, not a restatement of the diff — the diff already shows what
  changed. Use the body for context a future reader won't get from the code alone.
- Breaking changes: add a `BREAKING CHANGE:` footer describing the break and, if
  applicable, the migration path. Also prefix the type/scope with `!`, e.g.
  `feat(api)!: ...`.
- One logical change per commit. A commit that mixes an unrelated formatting pass with
  a behavior change should be split.
- Reference issues in the footer (`Fixes #123`, `Refs #456`), not the summary line.

### Examples

```
feat(search): add fuzzy matching to package search

Exact-match search was returning zero results for common typos
(e.g. "revewer" for "reviewer"). Adds a Levenshtein-distance fallback
when the exact query returns nothing.

Fixes #212
```

```
fix(cli): handle missing OPENAGENTS_REGISTRY env var

fix!: remove deprecated `--token` flag from `add` command

BREAKING CHANGE: `openagents add` no longer accepts `--token`; use
`OPENAGENTS_REGISTRY` with credentials embedded in the URL, or a
future `openagents login` command.
```

## Branch naming

```
<type>/<short-kebab-case-description>
```

Use the same `type` vocabulary as commits. Examples: `feat/fuzzy-search`,
`fix/cli-missing-env-var`, `refactor/catalog-loader`. Include an issue number when one
exists: `fix/212-search-typos`.

Avoid personal-name or date-based branch names (`zach/wip`, `2026-09-09`) — the branch
name should describe the change, not the author or timestamp (git already tracks both).

## PR descriptions

Use `templates/pr.md`. Every PR description should let a reviewer understand *what
changed and why* without reading the full diff first, and should describe how the
change was verified.

## When these rules don't fit

Hotfixes under genuine time pressure, or single-commit auto-generated PRs (e.g. a
dependency bot), may skip body/footer detail — but still use a correctly-typed summary
line so the history stays searchable by type.
