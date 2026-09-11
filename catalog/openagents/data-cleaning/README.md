# Dataset Profiler

Most wrong analyses are not wrong in the statistics, they are wrong in the assumptions
made about the data in the first ten minutes. This skill front-loads that: what each
column actually contains, where the nulls are and whether they are random, which rows
are duplicates, and which questions this dataset simply cannot answer.

## When to use

- Any dataset you did not create yourself.
- Before the first chart, model, or aggregate.
- When a number looks surprising and you need to know whether it is real.

## Install

```bash
npx openagents-cli add openagents/data-cleaning
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/data-cleaning/` |
| `codex` | `.codex/skills/data-cleaning/` |
| `openai-agents` | `agents/data-cleaning/` |
| `generic` | `.openagents/data-cleaning/` |

## What is in the package

- `SKILL.md` - the profiling procedure and what to report.
- `checks.md` - the specific checks per column type, with what each failure implies.

## License

MIT
