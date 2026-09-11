# Flaky Test Triage

The standard response to a flaky test is a retry annotation, which converts a real
signal into a slower green build. This workflow finds the cause instead. Almost all
flakiness comes from a short list of mechanisms, and each has a specific fix that makes
the test deterministic rather than merely quieter.

## When to use

- A test fails intermittently in CI and passes locally.
- Someone is about to add a retry or a sleep to make it stop.
- A whole suite has become untrustworthy and people have started ignoring red builds.

## Install

```bash
npx openagents-cli add openagents/flaky-test-triage
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/flaky-test-triage/` |
| `cursor` | `.cursor/rules/flaky-test-triage/` |
| `codex` | `.codex/skills/flaky-test-triage/` |
| `openai-agents` | `agents/flaky-test-triage/` |
| `langgraph` | `graphs/flaky-test-triage/` |
| `generic` | `.openagents/flaky-test-triage/` |

## What is in the package

- `WORKFLOW.md` - the procedure, from measuring the rate to proving the fix.
- `causes.md` - the mechanisms behind flakiness, each with its tell and its real fix.

## License

MIT
