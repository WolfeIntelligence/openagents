# Agent Eval Harness

Most agent changes ship on vibes: someone tries three prompts by hand, likes the
third, and merges. This harness replaces that with a small, honest eval suite. Enough
cases to notice a regression, graders that fail loudly when they cannot judge, and a
recorded baseline so "it got better" becomes a number you can check.

## When to use

- Before changing a prompt, model, or tool set that something depends on.
- When a change feels better and you need to know whether it actually is.
- When a bug is reported that you want to keep fixed. Every bug becomes a case.

## Install

```bash
npx openagents add openagents/eval-harness
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/eval-harness/` |
| `codex` | `.codex/skills/eval-harness/` |
| `openai-agents` | `agents/eval-harness/` |
| `langgraph` | `graphs/eval-harness/` |
| `generic` | `.openagents/eval-harness/` |

## What is in the package

- `HARNESS.md` - the procedure: collect cases, write graders, take a baseline, gate on it.
- `grading.md` - how to pick a grader per case type, and how to keep an LLM grader honest.
- `templates/cases.jsonl` - the case file format, with worked examples.

## License

MIT
