# Blameless Postmortem

Most postmortems fail in one of two ways: they name a person, or they end in a list of
actions with no owner that nobody does. This workflow builds the timeline from evidence
rather than memory, looks for the conditions that made the failure possible instead of
the individual who tripped over them, and produces actions that are specific enough to
be finished.

## When to use

- After any incident with customer impact, once the fire is out.
- After a near miss, which is a free lesson.
- When an incident recurs, since a recurrence means the last postmortem missed something.

## Install

```bash
npx openagents add openagents/postmortem-writer
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/postmortem-writer/` |
| `codex` | `.codex/skills/postmortem-writer/` |
| `openai-agents` | `agents/postmortem-writer/` |
| `generic` | `.openagents/postmortem-writer/` |

## What is in the package

- `WORKFLOW.md` - how to build the timeline, find contributing factors, and write actions.
- `templates/postmortem.md` - the document structure.

## License

MIT
