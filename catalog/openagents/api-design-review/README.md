# API Design Review

An API is the hardest thing in a codebase to change, because someone else's code
depends on the exact shape of it. This review catches the decisions that become
permanent: what the resources are called, how errors are reported, how a client pages
through results, and which fields you will regret making required.

## When to use

- Before the first client integrates against a new interface.
- When adding an endpoint to an existing API, to keep it consistent.
- Before making anything public, where a breaking change costs the most.

## Install

```bash
npx openagents add openagents/api-design-review
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/api-design-review/` |
| `cursor` | `.cursor/rules/api-design-review/` |
| `codex` | `.codex/skills/api-design-review/` |
| `openai-agents` | `agents/api-design-review/` |
| `generic` | `.openagents/api-design-review/` |

## What is in the package

- `SKILL.md` - what to review, in order of how expensive it is to get wrong.
- `checklist.md` - the pass, as concrete questions.

## License

MIT
