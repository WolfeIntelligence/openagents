# Test Writer Loop

A red/green harness that improves test coverage the disciplined way: pick an untested
behavior, write a test that fails first (proving it tests something real), implement
just enough to pass, run the full suite, record the coverage delta, and repeat — with
explicit stop conditions instead of running until told to stop.

## When to use

- A module or file has known-low coverage and you want it improved safely, without
  the agent quietly weakening tests to hit a number.
- Before a refactor, to build a safety net around code that currently has thin tests.
- As a bounded, reportable task ("spend up to 10 iterations improving coverage on
  `src/billing/`") rather than an open-ended request.

Not a fit for writing the *first* test infrastructure in a project with none at all
(set up a test runner first) or for end-to-end/integration test design, which needs
more upfront scoping than a per-behavior loop.

## Install

```bash
npx openagents-cli add openagents/test-writer-loop
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/test-writer-loop/` |
| `codex` | `.codex/skills/test-writer-loop/` |
| `openai-agents` | `.openai-agents/test-writer-loop/` |
| `generic` | `.openagents/test-writer-loop/` |

## Inputs

| name | type | required | default | description |
|---|---|---|---|---|
| `target_path` | path | no | auto | File/directory to focus on; auto-selects the lowest-coverage non-trivial module if omitted |
| `max_iterations` | number | no | `10` | Max red/green cycles per session |
| `coverage_command` | string | no | auto | Coverage command; auto-detected from the package manifest if omitted |

## Example run

```
> Run the test writer loop on src/billing/invoice.ts, max 8 iterations.
```

The harness baselines current coverage, picks the first untested behavior (e.g. "throws
on negative quantity"), writes a failing test, implements the fix if needed, runs the
full suite, records the delta, and continues until a stop condition in
`stop-conditions.md` is hit or 8 iterations pass — then reports before/after coverage
and any deferred gaps.

## Files

- `HARNESS.md` — overview, setup, guardrails (entry point).
- `loop.md` — the per-iteration red/green procedure.
- `stop-conditions.md` — hard stops, soft stops, and what's explicitly not a stop
  condition (coverage % alone).

## Limitations

- Needs a working test runner already configured in the project; it does not set one
  up from scratch.
- Behaviors requiring live infrastructure (a real database, an external API with no
  test double) are recorded as deferred gaps, not faked.
- Targets coverage as a signal of untested *behavior*, not a percentage to chase — it
  will stop before reaching an arbitrary number if remaining gaps are trivial.
