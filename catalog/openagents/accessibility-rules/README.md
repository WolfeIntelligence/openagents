# Accessibility Rules

Agent-written UI tends to fail accessibility in the same handful of ways: a div with an
onClick, an icon button with no name, focus styles removed for looking untidy, and ARIA
attributes bolted onto markup that would have been fine without them. These rules
target exactly those.

## When to use

- Any project where an agent writes or edits user interface code.
- Before shipping a component that a keyboard or screen reader user will meet.
- As the review standard for UI in a pull request.

## Install

```bash
npx openagents add openagents/accessibility-rules
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/accessibility-rules/` |
| `cursor` | `.cursor/rules/accessibility-rules/` |
| `codex` | `.codex/skills/accessibility-rules/` |
| `generic` | `.openagents/accessibility-rules/` |

## What is in the package

- `RULES.md` - the rules, each with the barrier it removes.
- `review-checklist.md` - a pass you can run in a browser in about five minutes.

## License

MIT
