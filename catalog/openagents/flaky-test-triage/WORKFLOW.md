# Flaky Test Triage

## 1. Establish the rate before touching anything

"Sometimes fails" is not a measurement. Run it `runs` times (default 50) and record the
failure rate.

```bash
# Adapt to your runner. The point is repetition and a count.
for i in $(seq 1 50); do <run one test> >/dev/null 2>&1 || echo "fail $i"; done | wc -l
```

Run it three ways, because the differences are the diagnosis:

| Condition | What a failure here implies |
|---|---|
| Alone, repeated | Self-contained nondeterminism: time, randomness, ordering |
| With the full suite | Shared state or pollution from another test |
| Under parallelism | Resource contention: ports, files, database rows |

A test that only fails in one of the three has already told you which family of cause
you are in.

## 2. Capture a failure with enough detail to read

Do not debug from the assertion message alone. On failure, capture:

- The full diff between expected and actual, not a truncated boolean.
- Timestamps at each step, to spot a timing edge.
- The random seed and the test execution order.
- Relevant environment: time zone, locale, machine, concurrency level.

If your runner cannot report the seed and the order, fix that first. Without it, an
ordering bug is unreproducible by construction.

## 3. Classify the cause

Work through `causes.md`. Match on the tell, not on intuition. The families, roughly in
order of frequency:

1. Order dependence and shared state
2. Time and clock assumptions
3. Concurrency and race conditions
4. Unseeded randomness
5. Resource contention
6. External dependencies
7. Genuine product bugs that only surface under a specific interleaving

The last one matters most: **a flaky test is sometimes a correct test finding a real
race.** Rule that out before assuming the test is at fault. Silencing it would be
deleting a bug report.

## 4. Prove the cause

A hypothesis is not confirmed until you can turn the failure on and off:

- Make it fail every time. Force the ordering, pin the clock, hold the lock, use the
  seed that fails. If you cannot make it fail deterministically, you have not found it.
- Then apply the fix and make it pass every time.

Skipping this step is how a test gets "fixed" three times and stays flaky.

## 5. Fix the cause, not the symptom

Ranked, best first:

1. **Remove the nondeterminism.** Inject the clock, seed the randomness, fix the shared
   state, await the actual condition.
2. **Make the test wait for a condition, never a duration.** `sleep` is a race with
   extra steps.
3. **Isolate the resource.** A unique port, a temp directory, a per-test schema.
4. **Narrow the assertion** if it was over-specifying, for example asserting an
   unordered collection in order.

Never acceptable as a fix: a retry annotation, a longer sleep, or a loosened assertion
that would no longer catch the original bug.

## 6. Quarantine honestly, if you must

Sometimes the fix cannot land today. Then:

- Move the test out of the blocking suite, but keep running it and keep reporting it.
- File an issue with the failure rate you measured and everything you established.
- Put an expiry on it. A quarantine with no date is a deletion with extra steps.
- Never quarantine a test whose failure you have not yet explained. That is where a
  real bug goes to be forgotten.

## 7. Verify

Re-run the same three conditions from step 1, at the same repetition count. Report the
before and after rates as numbers. "Seems better" is not a result.
