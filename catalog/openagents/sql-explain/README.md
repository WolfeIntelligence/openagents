# Query Plan Reader

The usual response to a slow query is to add an index to whatever column appears in
the WHERE clause, which sometimes helps and often does not. This skill reads the plan
properly: finds where time is actually spent, checks whether the planner's row
estimates match reality, and proposes the smallest change that addresses the real
cost rather than the obvious one.

## When to use

- A query got slow and nobody knows why.
- Before adding an index, to check that it will be used.
- When the planner picks a bad plan and you need to know what it believes.

## Install

```bash
npx openagents-cli add openagents/sql-explain
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/sql-explain/` |
| `cursor` | `.cursor/rules/sql-explain/` |
| `codex` | `.codex/skills/sql-explain/` |
| `openai-agents` | `agents/sql-explain/` |
| `generic` | `.openagents/sql-explain/` |

## What is in the package

- `SKILL.md` - the procedure, from getting a real plan to verifying the fix.
- `plan-nodes.md` - what each common plan node means and when it is the problem.

## License

MIT
