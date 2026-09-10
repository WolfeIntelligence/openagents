# SQL Safety Rules

The worst thing an agent can do to a database is not a syntax error, which fails
loudly. It is an UPDATE whose WHERE clause matched every row, or a migration that took
an exclusive lock on the busiest table at peak traffic. These rules exist to make both
impossible to do by accident.

## When to use

- Any project where an agent writes SQL or schema migrations.
- Especially against a database with real data and real traffic.
- As the review standard for a migration before it is approved.

## Install

```bash
npx openagents add openagents/sql-safety-rules
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/sql-safety-rules/` |
| `cursor` | `.cursor/rules/sql-safety-rules/` |
| `codex` | `.codex/skills/sql-safety-rules/` |
| `generic` | `.openagents/sql-safety-rules/` |

## What is in the package

- `RULES.md` - the rules, each naming the outage it prevents.
- `migration-checklist.md` - the pass to run over a migration before it ships.

## License

MIT
