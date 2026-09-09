# Test Writer Loop — Harness

A disciplined red/green loop for improving test coverage: pick an untested (or
under-tested) unit of behavior, write a test that fails for the right reason, implement
just enough to pass it, run the suite, and repeat — tracking coverage delta each cycle
so the loop has an objective stop condition instead of running forever.

This is a **harness**: it wraps a control loop around the agent's normal edit/run
cycle. See `loop.md` for the per-iteration procedure and `stop-conditions.md` for when
to end the session.

Inputs: `target_path` (optional — auto-selects lowest-coverage module if omitted),
`max_iterations` (default 10), `coverage_command` (auto-detected if omitted).

## Why red/green, not "write tests for this file"

Writing tests against code you're also about to change tests your assumptions about
the code, not the code's actual behavior. The loop instead:
1. Writes a test for behavior that **should** exist (from the spec/requirements, a
   docstring, an issue, or an inferred contract) and confirms it **fails** first —
   proving the test actually exercises something, and isn't a false-positive that
   would pass even against broken code.
2. Only then implements/fixes the behavior to make it pass.
3. Confirms the full suite is still green (no regressions from the change) before
   moving to the next unit.

This is the same discipline as classic TDD, applied opportunistically to existing
under-tested code rather than only to new code.

## Setup

1. Detect the test runner and coverage tool from the package manifest (`npm test`,
   `pytest --cov`, `go test -cover`, etc.), or use `coverage_command` if provided.
2. Run the existing suite once to get a coverage baseline. Record: overall %, and
   per-file/per-module % where the tool reports it.
3. If `target_path` is given, scope to it. Otherwise select the module with the lowest
   coverage that also has non-trivial logic (skip pure re-exports, generated code,
   trivial getters/setters, and config files — low coverage there isn't meaningful).

See `loop.md` for the iteration procedure and `stop-conditions.md` for when to stop.

## Selecting a target when none is given

When `target_path` is omitted, rank candidate modules by a combination of:
1. **Coverage %** — lower is more urgent, but see point 3 before picking the absolute
   lowest.
2. **Change frequency** — a module that shows up often in `git log` is more likely to
   regress silently; prioritize it over an equally-low-coverage module that rarely
   changes.
3. **Logic density** — skip modules that are low-coverage only because they're mostly
   type definitions, constants, or trivial pass-through code. A 20%-covered file with
   five branches of real logic is a better target than a 5%-covered file that's 200
   lines of enum declarations.
4. **Blast radius** — prefer modules imported by many other modules (a shared utility,
   a core data model) over leaf modules used in exactly one place, since a regression
   there has wider impact.

State the selection reasoning briefly before starting the loop (e.g. "targeting
`src/billing/invoice.ts`: 22% coverage, changed in 8 of the last 20 commits, and holds
the tax-calculation logic other modules depend on") so the choice is auditable rather
than opaque.

## Example session shape

```
Baseline: src/billing/invoice.ts — 22% line coverage, 0% branch coverage on error paths

Iteration 1: "throws when quantity is negative"
  red  → test fails with "expected InvalidQuantityError, got undefined"
  green → added validation + custom error class
  suite → 142/142 passing
  coverage → 31% (+9%)

Iteration 2: "rounds unit price to 2 decimal places on total"
  red  → test fails: 19.999999999998 !== 20.00
  green → applied Math.round in the total calculation
  suite → 143/143 passing
  coverage → 38% (+7%)

...

Stopped after iteration 6: two consecutive iterations added < 1% coverage;
remaining uncovered lines are defensive branches unreachable via the public API.

Final: 22% → 61% line coverage, 0% → 74% branch coverage on error paths.
6 tests added across 6 iterations. 1 gap deferred: currency-conversion path
requires a live exchange-rate API with no test double available here.
```

## Reporting

At the end of the session (whether stopped by a stop condition or `max_iterations`),
report:
- Coverage before → after (overall and for the targeted module(s)).
- Number of tests added, number of iterations run.
- Any behavior gaps found but *not* fixed (e.g. a bug the loop surfaced that's out of
  scope for a test-writing pass — flag it, don't silently fix unrelated bugs).
- Any test that was skipped/deferred and why (e.g. requires infrastructure not
  available in this environment, like a real database or external API).

## Guardrails

- Never delete or weaken an existing passing test to make the suite green faster.
- Never change production code's behavior to match a convenient test unless the
  existing behavior is confirmed to be a bug (and if so, call it out explicitly as a
  bug fix, not a routine coverage improvement).
- If implementing the missing behavior would require a design decision the harness
  can't infer (e.g. "what should happen on duplicate input" isn't specified anywhere),
  stop and ask rather than guessing silently.
- Keep each iteration's diff small and focused on one unit of behavior — this keeps
  the red/green cycle fast and makes each commit reviewable on its own.
