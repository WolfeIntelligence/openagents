# TypeScript Style Rules

Linters catch formatting. These rules catch the things that make agent-written
TypeScript quietly bad: `any` sprinkled to make an error go away, types that lie about
what a function returns, abstractions invented for a single caller, and errors
swallowed into a catch block that does nothing.

## When to use

- Any project where an agent writes or edits TypeScript.
- Alongside a linter and formatter, not instead of one. These cover judgment, not layout.
- As the standard for reviewing TypeScript an agent produced.

## Install

```bash
npx openagents add openagents/typescript-style-rules
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/typescript-style-rules/` |
| `cursor` | `.cursor/rules/typescript-style-rules/` |
| `codex` | `.codex/skills/typescript-style-rules/` |
| `generic` | `.openagents/typescript-style-rules/` |

## What is in the package

- `RULES.md` - the rules themselves, each with the failure it prevents.
- `review-checklist.md` - a short pass to run over a diff before calling it done.

## License

MIT
