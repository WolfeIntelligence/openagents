# Agent Guardrails

A safety harness for autonomous/semi-autonomous agent runs: classifies every action as
read-only, reversible-write, or destructive; gates destructive actions behind explicit
human confirmation (stated blast radius, no pre-approval loopholes); enforces
turn/budget limits with a clean halt-and-summarize instead of a hard kill; and appends
every action to a structured, append-only JSON Lines audit log.

## When to use

- Wrapping any agent run with meaningful autonomy (multi-step, tool-using, especially
  unattended/scheduled runs) where destructive mistakes are costly.
- Environments with compliance/audit requirements — the JSON Lines log gives a
  reviewable record of every action taken.
- Long-running agent sessions where an unbounded loop is a real risk (turn/budget caps).

## Install

```bash
npx openagents-cli add openagents/agent-guardrails
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/agent-guardrails/` |
| `codex` | `.codex/skills/agent-guardrails/` |
| `openai-agents` | `.openai-agents/agent-guardrails/` |
| `langgraph` | `.langgraph/agent-guardrails/` |
| `generic` | `.openagents/agent-guardrails/` |

## Inputs

| name | type | required | default | description |
|---|---|---|---|---|
| `max_turns` | number | no | `50` | Max tool-call rounds before halting to ask for continuation |
| `budget_usd` | number | no | — | Soft cost ceiling before halting (only enforced where the runtime exposes cost tracking) |
| `audit_log_path` | path | no | `.openagents/audit.log.jsonl` | Where audit entries are appended (JSON Lines) |

## Example run

```
> Use the agent-guardrails harness for this cleanup task. Max 30 turns.
```

Read-only exploration proceeds freely; file edits are logged; a proposed
`DROP TABLE staging_events` is held at the confirmation gate with the exact row count
and no-undo warning stated before the agent waits for explicit approval; at 30 turns
the harness halts, summarizes progress, and asks whether to continue.

## Files

- `HARNESS.md` — the pre-action check, confirmation gate, turn/budget limits, and
  audit logging rules (entry point).
- `policies/destructive-actions.md` — concrete classification rules (read-only vs.
  reversible-write vs. destructive) with examples.
- `audit-log.schema.json` — JSON Schema for each audit log entry.

## Limitations

- This is a set of instructions the agent follows, not a sandboxed enforcement
  mechanism — it constrains a cooperative agent, it does not replace OS/infra-level
  permission boundaries for untrusted code execution.
- Budget tracking is only as good as the runtime's own cost-reporting; if unavailable,
  the harness says so rather than silently pretending to enforce it.
- The confirmation gate requires a reachable human operator; unattended runs that hit a
  destructive action will block on it and report rather than proceed.
