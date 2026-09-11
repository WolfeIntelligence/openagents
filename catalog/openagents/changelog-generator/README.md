# Changelog Generator

Turns a git commit range into a grouped `CHANGELOG.md` entry following the
[Keep a Changelog](https://keepachangelog.com/) format: Breaking Changes, Added, Fixed,
and Performance sections, each entry linked back to its issue/PR/commit. Works best on
history following Conventional Commits, but classifies unstructured commits too.

## When to use

- Cutting a release and need a changelog entry without manually re-reading every
  commit in the range.
- Generating release notes for a tag before publishing.
- Maintaining an `Unreleased` section incrementally as PRs merge.

## Install

```bash
npx openagents-cli add openagents/changelog-generator
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/changelog-generator/` |
| `codex` | `.codex/skills/changelog-generator/` |
| `generic` | `.openagents/changelog-generator/` |

## Inputs

| name | type | required | default | description |
|---|---|---|---|---|
| `from_ref` | string | yes | — | Starting git ref (exclusive), e.g. the previous release tag |
| `to_ref` | string | no | `HEAD` | Ending git ref (inclusive) |
| `version` | string | no | — | Version label for the new section; left as "Unreleased" if omitted |

## Example run

```
> Generate a changelog entry from v1.2.0 to HEAD, label it 1.3.0.
```

The agent walks `git log v1.2.0..HEAD`, classifies each commit (feat/fix/perf/breaking),
merges related commits, links each entry to its issue/PR where determinable, and
inserts a `## [1.3.0] - 2026-09-09` section at the top of `CHANGELOG.md`.

## Files

- `WORKFLOW.md` — the step-by-step procedure (entry point).

## Related

- `openagents/commit-conventions` — a Conventional Commits rules set that makes this
  generator's classification far more reliable; listed as a soft `requires`.

## Limitations

- Classification quality depends on commit message quality; unstructured history is
  still processed but with best-effort (not guaranteed-accurate) type inference.
- Link generation needs a recognizable git remote URL (GitHub/GitLab-style) and,
  ideally, the `gh` CLI for PR lookups; otherwise links fall back to raw commit SHAs.
- Ranges over ~150 commits are summarized by theme rather than fully enumerated, to
  keep the entry readable.
