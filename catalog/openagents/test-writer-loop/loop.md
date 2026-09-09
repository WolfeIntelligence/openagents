# Loop — Per-Iteration Procedure

Repeat this cycle up to `max_iterations` times, or until a stop condition in
`stop-conditions.md` is hit.

## 1. Select the next unit of behavior

Within the current target module, pick one specific, nameable behavior that isn't
covered: a function, a branch (if/else path), an error case, or a boundary condition
(empty input, zero, max value, duplicate). Prefer, in order:
1. Untested error paths and edge cases in code that *is* partially tested (these hide
   the most real bugs).
2. Fully untested public functions/methods.
3. Untested branches within partially-tested functions.

Avoid picking multiple unrelated behaviors in one iteration — one behavior per cycle
keeps the red/green signal clean.

## 2. Write the failing test (red)

- Name the test after the behavior, not the implementation:
  `"throws when quantity is negative"`, not `"test2"`.
- Assert on outcome (return value, thrown error, emitted event, persisted state), not
  on internal implementation details that would make the test brittle to refactors.
- Run just this test (or the smallest relevant subset) and confirm it **fails**. If it
  passes immediately, the test isn't exercising new behavior — revise it before
  proceeding; a test that never fails is worse than no test.
- Confirm the failure reason matches expectations (e.g. "expected error, got
  undefined" — not a typo or import error unrelated to the behavior under test).

## 3. Implement (green)

- Write the minimum code needed to make the test pass. Resist adding unrelated
  improvements in the same step — that's a separate change.
- Run the same test again and confirm it now passes.

## 4. Run the full suite

- Run the complete test suite (not just the new test) to catch regressions.
- If something else broke, fix it before moving on — do not proceed to the next
  iteration with a red suite.

## 5. Record the delta

- Re-run the coverage tool (or estimate if per-iteration coverage runs are too slow —
  in that case, run coverage every N iterations and note the cadence).
- Note: test added, coverage before → after for the targeted file, iteration count.

## 6. Decide: continue or stop

Check `stop-conditions.md`. If none apply and `max_iterations` isn't reached, return to
step 1 and pick the next behavior.
