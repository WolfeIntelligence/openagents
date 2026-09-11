# Technical Writing Rules

Agent prose has recognizable tells: an opening that restates the question, three
hedges per paragraph, a bulleted list where a sentence would do, and a closing offer
nobody asked for. These rules cut all of it, and add the one that matters most, which
is never sounding more certain than you are.

## When to use

- Documentation, READMEs, commit messages, PR descriptions, and code comments.
- Status updates and summaries an agent writes for a human to read.
- Anywhere an agent's output will be read by someone who was not watching it work.

## Install

```bash
npx openagents-cli add openagents/writing-style-rules
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/writing-style-rules/` |
| `cursor` | `.cursor/rules/writing-style-rules/` |
| `codex` | `.codex/skills/writing-style-rules/` |
| `openai-agents` | `agents/writing-style-rules/` |
| `generic` | `.openagents/writing-style-rules/` |

## What is in the package

- `RULES.md` - the rules, with a before and after for each.
- `patterns.md` - the specific phrases to cut, and what to write instead.

## License

MIT
