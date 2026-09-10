# Performance Investigation

## 1. Define slow, in numbers

"The page is slow" cannot be finished. Get to a statement that can be:

- Which operation, with which inputs?
- What is it now, at p50, p95 and p99? An average alone hides the problem you were
  called about.
- What would be acceptable? Without a target you cannot know when to stop.
- Is it slow always, or under a condition? Load, data size, a particular tenant, a cold
  cache. The condition is frequently the whole answer.

## 2. Baseline before touching anything

Record a reproducible measurement. See `measurement.md`. Without a baseline you cannot
tell an improvement from noise, and every later claim is unfalsifiable.

Capture the environment too: machine, data size, concurrency, cache state, versions. A
baseline that cannot be reproduced is not a baseline.

## 3. Profile. Do not theorize

Get a profile before forming a hypothesis. Intuitions about where time goes are wrong
often enough that the profile is always cheaper than the argument.

Match the tool to the shape:

- **CPU-bound:** a sampling profiler, read as a flame graph.
- **I/O-bound:** trace the calls. Count queries, requests, file reads.
- **Distributed:** a trace across services, to find which hop owns the time.
- **Memory-driven:** allocation profile, plus garbage collection pauses.

Read the profile for **total inclusive time**, not for what looks inefficient. A tidy
function called two million times beats an ugly one called twice.

## 4. Find the actual top cost

Usually one of these, and they are worth checking in order:

1. **Repeated work.** The N+1 query, the same request in a loop, a computation not
   memoized. The most common cause by a wide margin.
2. **Work not needed.** Fetching columns nobody reads, serializing a field nobody uses,
   sorting a list that gets filtered afterwards.
3. **Wrong data structure.** A linear scan where a hash lookup belongs, quadratic
   behavior that was fine at ten items and is not at ten thousand.
4. **Waiting.** Sequential calls that could overlap. Look for a series of awaits with no
   dependency between them.
5. **Serialization boundaries.** JSON encode and decode, ORM hydration, network hops.

## 5. Change one thing

One change, then re-measure. Batched changes make it impossible to attribute the
result, and one of them is usually making things worse while another hides it.

Prefer, in order: delete the work, do it once instead of N times, do it concurrently,
do it faster. Deleting work always wins, and it is the option people consider last.

## 6. Verify honestly

Re-run the same measurement, same environment, enough repetitions to see past noise.

Report:

- Before and after at p50, p95 and p99, with the same units.
- Whether the difference exceeds run-to-run variance. If it does not, it is not a result.
- **What got worse.** Nearly every optimization trades something: memory, cold-start,
  code clarity, a different workload. Name the trade.
- Whether the goal from step 1 is met, or how far short it falls.

If the change did not help, revert it. An optimization that does not measurably help is
pure cost, paid by every future reader.

## 7. Stop at the goal

Stop when the target is met. Continuing past it trades readability for numbers nobody
needed, and the next person to read the code pays for it.
