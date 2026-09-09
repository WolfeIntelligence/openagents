# Stop Conditions

Check these after every iteration (Step 6 of `loop.md`). Stop the loop and report as
soon as any of these is true — do not keep iterating past them.

## Hard stops (always stop)

- `max_iterations` reached.
- The full test suite is red and the harness cannot get it green again after a
  reasonable attempt (e.g. 2 focused retries) — stop and report the failure rather
  than leaving the repo in a broken state.
- A behavior requires infrastructure not available in this environment (a live
  database, an external API with no test double, network access) and no reasonable
  mock/fixture can be constructed — record it as a deferred gap, don't fake a pass.
- A behavior gap turns out to require a product/design decision the harness can't
  infer from the code, docs, or issue tracker (e.g. undefined behavior on conflicting
  input with no spec) — stop and ask the user rather than guessing.

## Soft stops (stop and report, this is success)

- Coverage for the targeted module reaches a clear plateau: two consecutive iterations
  with no meaningful coverage increase (e.g. < 1%) because remaining uncovered lines
  are trivial (simple getters, defensive code that can't realistically be reached).
- All identified untested behaviors in the targeted scope have been covered — don't
  invent artificial tests just to keep the loop running.
- Diminishing returns: the last 2-3 iterations added tests for increasingly contrived
  edge cases with low real-world likelihood. Note these as candidates but stop.

## Explicitly not a stop condition

- Reaching a specific coverage percentage number (e.g. "80%") — coverage percentage is
  a signal, not a goal; a module can be well-tested at 70% (all the real branches
  covered) or poorly tested at 95% (assertion-free tests padding the number). Judge by
  behavior coverage, not the raw metric.
