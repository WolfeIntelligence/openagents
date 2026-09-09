---
title: Package Kinds
description: Workflow vs. harness vs. rules vs. skill — what each kind is for, with examples from the seed catalog.
order: 3
---

# Package Kinds

Every package declares one `kind` in its manifest. The kind doesn't change how a
package is installed (that's determined by `runtimes` — see
[Runtimes](/docs/runtimes)), but it signals *how* the content is meant to be used by
an agent, and is a primary filter on [`/explore`](/explore).

| kind | what it is |
|---|---|
| `workflow` | A multi-step, goal-directed procedure an agent executes (e.g. "review this PR"). |
| `harness` | Scaffolding around an agent: loop control, tool wiring, eval hooks, guards. |
| `rules` | Constraints / style / policy files an agent must obey (e.g. a CLAUDE.md set). |
| `skill` | A reusable capability with its own instructions + helper scripts. |

## `workflow`

A procedure with a beginning, middle, and end: gather context, do the work in a
defined order, produce a specific output, and know when to stop. Invoked for a
specific task, not left running continuously.

**Examples in the seed catalog:**
- [`pr-reviewer`](/p/openagents/pr-reviewer) — gather diff → classify risk → checklist
  → severity-tagged report.
- [`repo-onboarding`](/p/openagents/repo-onboarding) — map an unfamiliar codebase →
  write `ONBOARDING.md`.
- [`changelog-generator`](/p/openagents/changelog-generator) — git log range → grouped
  changelog entry.
- [`incident-runbook`](/p/openagents/incident-runbook) — triage → mitigate → comms →
  postmortem, with severity timers.

Use a `workflow` when the task is "do this specific thing, start to finish."

## `harness`

A control loop or scaffold that wraps the agent's normal behavior — it changes *how*
the agent operates across many actions, not what one specific task looks like. Often
includes explicit stop conditions, iteration limits, or pre-action checks.

**Examples:**
- [`test-writer-loop`](/p/openagents/test-writer-loop) — a red/green loop with
  iteration limits and coverage-based stop conditions.
- [`agent-guardrails`](/p/openagents/agent-guardrails) — pre-action checks for
  destructive operations, turn/budget limits, and an audit log.

Use a `harness` when you're constraining or structuring the agent's autonomy itself,
not just handing it one task.

## `rules`

Standing constraints the agent should follow for the life of a project or session —
loaded once (e.g. into a `CLAUDE.md`/`AGENTS.md` include, a Cursor rules file) and
applied continuously, rather than invoked per-task. No procedure to execute, no start/
end — just "always do (or never do) this."

**Examples:**
- [`secure-coding-rules`](/p/openagents/secure-coding-rules) — secrets, input
  validation, authz, dependency hygiene, PII logging.
- [`commit-conventions`](/p/openagents/commit-conventions) — Conventional Commits,
  branch naming, PR description template.

Use `rules` when the content is "constraints the agent should never violate," not a
task it completes and reports back on.

## `skill`

A reusable capability the agent invokes when a specific kind of task comes up —
typically paired with helper templates or scripts, similar in spirit to a workflow but
framed as a capability the agent *has* rather than a task it's assigned. In practice
the line between `skill` and `workflow` is about framing: a skill is "I can do X,"
invoked whenever X is needed; a workflow is closer to "do X now, this specific time."

**Example:**
- [`research-brief`](/p/openagents/research-brief) — turn any question into a sourced
  brief: search plan, source grading, claim ledger, brief template.

## Choosing a kind for your own package

Ask: does this run once per invocation with a clear end state (→ `workflow`), does it
change the agent's operating loop itself (→ `harness`), is it a standing constraint
with no "done" state (→ `rules`), or is it a capability invoked opportunistically
whenever it's relevant (→ `skill`)? When genuinely unsure, `workflow` is the safest
default — most packages are.
