# Tool Budget Guard

An agent with no budget does not fail loudly, it fails expensively. It retries the
same broken command nine times, re-reads a file it already has, and burns twenty
minutes before anyone notices. This harness puts a ceiling on tool calls, tokens and
wall-clock time, and, the part most budget code skips, says exactly what happens when
the ceiling is hit.

## When to use

- Any long-running or autonomous task where nobody is watching each step.
- Agents that call paid APIs, where a loop is a bill.
- Any agent that has ever gotten stuck repeating itself.

## Install

```bash
npx openagents add openagents/tool-budget-guard
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/tool-budget-guard/` |
| `codex` | `.codex/skills/tool-budget-guard/` |
| `openai-agents` | `agents/tool-budget-guard/` |
| `langgraph` | `graphs/tool-budget-guard/` |
| `generic` | `.openagents/tool-budget-guard/` |

## What is in the package

- `HARNESS.md` - the budget model, the checks, and the escalation ladder.
- `budgets.md` - starting numbers by task shape, and how to tune them from real runs.

## License

MIT
