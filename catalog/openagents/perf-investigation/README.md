# Performance Investigation

Performance work done by intuition optimizes the code that is easy to read rather than
the code that is slow. This workflow insists on a baseline before any change, a profile
before any theory, one change at a time, and a verification that reports the real
number including the cases that got worse.

## When to use

- Something got slow and you need to know why, not guess.
- Before a rewrite justified by performance, to check the premise.
- When an optimization is proposed and nobody has measured the thing it targets.

## Install

```bash
npx openagents add openagents/perf-investigation
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/perf-investigation/` |
| `cursor` | `.cursor/rules/perf-investigation/` |
| `codex` | `.codex/skills/perf-investigation/` |
| `openai-agents` | `agents/perf-investigation/` |
| `generic` | `.openagents/perf-investigation/` |

## What is in the package

- `WORKFLOW.md` - the loop: baseline, profile, one fix, verify.
- `measurement.md` - how to measure without fooling yourself.

## License

MIT
