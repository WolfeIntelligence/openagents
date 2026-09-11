# Human In The Loop

The failure mode of an approval gate is not that it lets something bad through. It is
that it asks so often, and so vaguely, that the human starts approving without
reading. This harness defines what genuinely needs a human, how to ask so the answer
is informed, and how far a given approval extends.

## When to use

- Agents that can write, send, deploy, delete, or spend.
- Unattended or scheduled runs, where a bad action is found long after the fact.
- Any workflow where a mistake is expensive to undo.

## Install

```bash
npx openagents-cli add openagents/human-in-the-loop
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/human-in-the-loop/` |
| `cursor` | `.cursor/rules/human-in-the-loop/` |
| `codex` | `.codex/skills/human-in-the-loop/` |
| `openai-agents` | `agents/human-in-the-loop/` |
| `langgraph` | `graphs/human-in-the-loop/` |
| `generic` | `.openagents/human-in-the-loop/` |

## What is in the package

- `HARNESS.md` - when to stop, how to ask, and the scope of an approval.
- `gates.md` - a classification of actions by reversibility, with the gate each needs.

## License

MIT
