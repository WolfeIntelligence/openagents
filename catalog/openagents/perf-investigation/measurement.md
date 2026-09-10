# Measuring without fooling yourself

## Repetitions and warm-up

- Never trust one run. Take at least 5, ideally 20 or more for short operations.
- Discard warm-up runs explicitly, and say how many. JIT compilation, connection pools
  and caches all make the first run unrepresentative.
- Report the distribution, not the mean alone. p50 and p95 tell different stories, and
  the complaint you received is almost always about p95.

## Realistic conditions

- **Production-shaped data.** An algorithm that is quadratic looks fine on 100 rows.
- **Production-shaped concurrency.** Contention only appears under load.
- **Honest cache state.** Measure both cold and warm, and label which is which.
- **A machine that is not doing other things.** Your laptop compiling in the background
  is not a benchmark environment.

## Traps

- **Measuring the wrong layer.** A fast function inside a slow request means the time is
  elsewhere. Measure end to end first, then narrow.
- **Optimizing a benchmark.** If the benchmark does not resemble the real workload, you
  will make the benchmark faster and the product slower.
- **Dead code elimination.** A compiler may remove work whose result you never use.
  Consume the result.
- **Confusing throughput with latency.** Batching improves one and worsens the other.
  Know which one the complaint was about.
- **Ignoring variance.** A 5% improvement inside 15% run-to-run noise is not an
  improvement, it is a coin flip you liked the result of.

## What to record with every measurement

So it can be reproduced and compared later:

- Command or code path, exactly.
- Input size and shape.
- Machine, cores, memory.
- Runtime and library versions.
- Concurrency level.
- Cache state.
- Repetition count and the discarded warm-up count.
- Raw numbers, not only the summary.
