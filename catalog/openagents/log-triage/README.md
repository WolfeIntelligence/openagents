# Log Triage

The failure mode of reading logs is anchoring on the first stack trace and explaining
everything else in its terms. This skill works the other way: establish the timeline
first, separate what changed from what is always noisy, and only then form hypotheses,
ranked by evidence and each with a cheap test attached.

## When to use

- An incident where you have logs and no diagnosis.
- A failure that reproduces intermittently and you need to find the pattern.
- Any time you catch yourself already sure of the cause after reading one line.

## Install

```bash
npx openagents add openagents/log-triage
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/log-triage/` |
| `cursor` | `.cursor/rules/log-triage/` |
| `codex` | `.codex/skills/log-triage/` |
| `openai-agents` | `agents/log-triage/` |
| `langgraph` | `graphs/log-triage/` |
| `generic` | `.openagents/log-triage/` |

## What is in the package

- `SKILL.md` - the triage procedure, and the mistakes it exists to prevent.
- `templates/triage.md` - the output format: timeline, hypotheses, tests.

## License

MIT
