# Python Style Rules

Python lets an agent write something that runs and is still wrong: a bare `except` that
hides a typo, a mutable default that accumulates across calls, a dependency added for
one function. These rules target the mistakes that survive a passing test run.

## When to use

- Any project where an agent writes or edits Python.
- Alongside a formatter and linter, which handle layout. These handle judgment.
- As the standard for reviewing Python an agent produced.

## Install

```bash
npx openagents add openagents/python-style-rules
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/python-style-rules/` |
| `cursor` | `.cursor/rules/python-style-rules/` |
| `codex` | `.codex/skills/python-style-rules/` |
| `generic` | `.openagents/python-style-rules/` |

## What is in the package

- `RULES.md` - the rules, each with the failure it prevents.
- `review-checklist.md` - a short pass over a diff before calling it done.

## License

MIT
