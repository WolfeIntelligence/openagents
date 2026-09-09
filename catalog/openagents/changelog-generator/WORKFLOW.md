# Changelog Generator — Workflow

Turns a git commit range into a grouped, human-readable `CHANGELOG.md` entry: features,
fixes, and breaking changes separated out, each linked to its issue/PR where possible.
Works best on a history following Conventional Commits (see `openagents/commit-conventions`,
listed as a soft dependency), but degrades gracefully on unstructured history too.

Inputs: `from_ref` (required), `to_ref` (default `HEAD`), `version` (optional; section
is labeled "Unreleased" if omitted).

## Step 1 — Collect the commit range

```bash
git log <from_ref>..<to_ref> --pretty=format:'%H|%s|%b|%an' --no-merges
```

- Exclude merge commits (`--no-merges`) — they're usually noise for a changelog; if the
  project's workflow is merge-commit-based instead of squash/rebase, adjust and include
  merge commit subjects instead, but say so.
- Also gather: `git diff <from_ref>..<to_ref> --stat` for a sanity check on scope, and
  the repository's issue/PR URL pattern (from the remote `origin` URL) to build links.

## Step 2 — Parse and classify each commit

For each commit subject, extract `type(scope): summary` if it matches Conventional
Commits. For commits that don't match the format:
- Infer a type from the diff/summary content as a best effort (e.g. a summary starting
  with "add" → likely `feat`; "fix"/"resolve" → `fix`).
- Mark these as inferred (not explicit) — if the output format distinguishes, note it;
  regardless, still classify rather than dropping them, since a changelog should
  reflect all user-relevant history in the range, not just the well-formatted commits.

Group by type:
- `feat` → **Added** / **Features**
- `fix` → **Fixed**
- `perf` → **Performance**
- `refactor`, `style`, `chore`, `build`, `ci`, `test` → generally omit from a
  user-facing changelog (internal-only) *unless* the body indicates user-visible
  impact — use judgment, don't include noise.
- `docs` → **Documentation** (only if the project's changelog convention includes
  docs; otherwise omit)
- Anything with a `BREAKING CHANGE:` footer or `!` after the type/scope → **Breaking
  Changes**, always included regardless of type, and always listed first within its
  section.

## Step 3 — Deduplicate and merge

- Multiple commits that are really one logical change (e.g. a feature commit plus a
  follow-up fix commit for the same feature within the range) should be merged into
  one changelog line where that reads more clearly — use judgment, don't force it.
- Revert commits that cancel out an earlier commit in the *same* range should cancel
  each other out of the changelog entirely (net-zero user impact).

## Step 4 — Add links

For each entry, if the commit footer references an issue/PR number (`Fixes #123`,
`Refs #456`) or the commit is reachable via a known PR (e.g. via `gh pr list --search
<sha>` if `gh` is available), append a link: `([#123](<repo-url>/issues/123))`. If no
reference is found, link the commit itself: `([abc1234](<repo-url>/commit/<sha>))`.
Don't fabricate a link if neither is determinable — omit it for that entry instead.

## Step 5 — Write the entry

Follow [Keep a Changelog](https://keepachangelog.com/) structure:

```markdown
## [<version or "Unreleased">] - <YYYY-MM-DD, omit date if Unreleased>

### Breaking Changes
- <description of the break and migration path, if given in the commit body> ([#123](...))

### Added
- <summary, imperative→noun-phrase form, e.g. "add fuzzy search to package search"> ([#123](...))

### Fixed
- <summary> ([#456](...))

### Performance
- <summary> ([#789](...))
```

Omit any section with zero entries — don't print an empty `### Fixed` heading.

Insert this new section at the top of `CHANGELOG.md`, directly under the file's H1
title (create the file with a standard header if it doesn't exist yet). Do not
reformat or reflow existing changelog entries below the insertion point.

## Step 6 — Review pass

Before finalizing, re-read the generated entries as a *user* of the project, not the
author: does each line make sense without repo-internal context (variable names,
internal file paths)? Rewrite any entry that only makes sense to someone who read the
diff. Flag (but don't silently drop) any commit whose purpose is genuinely unclear from
its message alone — list it under a `### Uncategorized` section at the bottom for a
human to triage, rather than guessing at user-facing wording.

## Stop conditions

- `from_ref` doesn't exist or the range is empty → report this, don't generate an empty
  section.
- Range contains more than ~150 commits → note that the changelog may be coarse and
  offer to summarize by theme instead of enumerating every commit.
