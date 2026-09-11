# Commit Conventions

Standing rules for commit messages (Conventional Commits), branch naming, and PR
descriptions. Keeps git history searchable by type/scope and makes PRs reviewable
without reading the full diff first.

## When to use

- Load into any repo that wants a consistent, machine-parseable commit history (e.g.
  for automated changelog generation — pairs well with `changelog-generator`).
- Teams standardizing on Conventional Commits for semantic-release / automated
  versioning tooling.
- Solo projects that still want a searchable history months later.

## Install

```bash
npx openagents-cli add openagents/commit-conventions
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/commit-conventions/` |
| `cursor` | `.cursor/rules/commit-conventions/` |
| `codex` | `.codex/skills/commit-conventions/` |
| `generic` | `.openagents/commit-conventions/` |

## Inputs

None — static rules, no runtime parameters.

## Example run

```
> Commit these changes following our conventions.
```

The agent classifies the change (`fix`, `feat`, etc.), writes an imperative-mood
summary under ~72 chars, adds a body explaining why when non-obvious, and — if opening
a PR — fills out `templates/pr.md` with a scannable summary, change list, and testing
notes.

## Files

- `RULES.md` — commit message format, types table, branch naming, examples (entry
  point).
- `templates/pr.md` — the PR description template and guidance on filling it out.

## Limitations

- Conventions only — does not install a commit-lint hook or enforce the format
  automatically; pair with `commitlint`/a pre-commit hook for hard enforcement.
- Assumes a squash-or-rebase workflow where commit type matters for changelog
  generation; teams doing merge commits with heavy commit-squashing later may care more
  about PR titles than individual commit messages.
