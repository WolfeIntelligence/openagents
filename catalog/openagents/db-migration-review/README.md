# Migration Review

A migration is reviewed like code and behaves like a deployment. The failures that
matter are not syntax errors, they are the exclusive lock taken on the busiest table at
peak, and the column dropped in the same deploy as the code that stopped using it. This
workflow checks the things that cause outages.

## When to use

- Any schema change against a database with real data.
- Before approving a migration in review.
- Especially for tables large enough that a table rewrite is measured in minutes.

## Install

```bash
npx openagents-cli add openagents/db-migration-review
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/db-migration-review/` |
| `cursor` | `.cursor/rules/db-migration-review/` |
| `codex` | `.codex/skills/db-migration-review/` |
| `generic` | `.openagents/db-migration-review/` |

## What is in the package

- `WORKFLOW.md` - the review, in order of what causes outages.
- `patterns.md` - safe recipes for the changes that are usually done unsafely.

## License

MIT
