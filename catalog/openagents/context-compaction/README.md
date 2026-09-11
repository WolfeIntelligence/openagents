# Context Compaction

A long task does not fail at the context limit, it degrades well before it. The agent
starts forgetting decisions it made an hour ago, re-litigates settled questions, and
re-reads files it already understood. This harness compacts deliberately: it decides
in advance what must survive, writes a checkpoint that can be resumed cold, and drops
the rest.

## When to use

- Multi-hour or multi-session tasks: migrations, large refactors, long investigations.
- Any agent loop that runs until a goal is met rather than for a fixed number of steps.
- Work that may be interrupted and picked up later, possibly by someone else.

## Install

```bash
npx openagents-cli add openagents/context-compaction
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/context-compaction/` |
| `codex` | `.codex/skills/context-compaction/` |
| `openai-agents` | `agents/context-compaction/` |
| `langgraph` | `graphs/context-compaction/` |
| `generic` | `.openagents/context-compaction/` |

## What is in the package

- `HARNESS.md` - what survives compaction, what does not, and when to trigger it.
- `templates/checkpoint.md` - the checkpoint format, resumable without the transcript.

## License

MIT
