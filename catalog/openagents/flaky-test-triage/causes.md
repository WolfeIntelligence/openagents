# Why tests go flaky

## Order dependence and shared state

**Tell:** passes alone, fails in the suite, or fails only in a particular order.

Shared module state, a database not rolled back, a global registry, a cached singleton,
a file left behind, an environment variable set by another test.

**Fix:** make each test set up and tear down its own state. Randomize test order
permanently so this cannot silently return.

## Time

**Tell:** fails near midnight, at month boundaries, in a particular time zone, or on a
fast machine.

Tests that assert on `now`, assume a day is 24 hours, compare wall-clock durations, or
depend on daylight saving.

**Fix:** inject the clock. Never call the system clock from code under test. Use a fixed
instant in tests, and include an awkward one such as a leap day or a DST boundary.

## Concurrency

**Tell:** fails more under parallelism or on machines with more cores.

Real races: unsynchronized shared access, an assertion made before the work completes,
a callback that has not fired yet.

**Fix:** await the condition rather than a duration. If the race is in the product code
rather than the test, you have found a bug. Do not fix it in the test.

## Randomness

**Tell:** fails at a stable low rate with no environmental pattern.

Unseeded generators, random data that occasionally violates an assumption, hash
iteration order.

**Fix:** seed deterministically, and log the seed on every run. When a property-based
test finds a failing case, add that case as a permanent example test.

## Resource contention

**Tell:** fails only in CI, or only when several jobs run together.

Hardcoded ports, a shared temp path, a shared database, a fixed filename.

**Fix:** allocate dynamically. Port zero, a temp directory per test, a schema per worker.

## External dependencies

**Tell:** failures correlate with network conditions or another team's deploys.

A real HTTP call, a real DNS lookup, a shared staging environment, a rate limit.

**Fix:** stub at the boundary. Keep a small number of genuine integration tests, run
them separately, and never let them gate a unit test suite.

## A real bug

**Tell:** the failure is a legitimate assertion failure that only occurs under a
specific interleaving or input.

**Fix:** fix the product. This is the case where the flaky test was doing its job, and
the retry annotation would have hidden a defect that will eventually reach production.
