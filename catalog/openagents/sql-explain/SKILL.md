# Query Plan Reader

## 1. Get a plan with real numbers

An estimate-only plan tells you what the planner believes, not what happened. Ask for
timings and buffers:

```sql
-- Postgres
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <query>;

-- MySQL 8+
EXPLAIN ANALYZE <query>;

-- SQLite
EXPLAIN QUERY PLAN <query>;
```

`ANALYZE` runs the query. On a write statement, wrap it in a transaction and roll back.

## 2. Find where the time actually goes

Read from the innermost node outward. For each node, note **actual time**, **actual
rows**, and **loops**. Two traps:

- **Postgres reports per-loop time.** A node showing 2ms with `loops=5000` cost 10
  seconds, not 2ms. Multiply before deciding anything.
- **Cost is not time.** Cost is an arbitrary unit for comparing plans. Never report it
  as a duration.

The bottleneck is the node with the largest actual total time that is not simply the
sum of its children. That is the one to fix. Everything else is noise.

## 3. Compare estimated rows to actual rows

This single ratio explains most bad plans.

| Estimate vs actual | What it means | What to do |
|---|---|---|
| Within about 10x | Planner is informed | Trust the plan shape; fix the node |
| Estimate far too low | Stale or missing statistics | `ANALYZE <table>` and re-check |
| Estimate far too high | Correlated predicates the planner treats as independent | Extended statistics, or rewrite |

A planner that thinks a node returns 1 row will happily choose a nested loop that runs
a million times. Fix the estimate before fixing anything else. Very often the whole
problem is stale statistics and no index is needed at all.

## 4. Identify the real problem

Work through in order:

1. **Sequential scan on a large table with a selective predicate.** Missing or unusable
   index. Check the predicate is sargable: a function on the column, a leading
   wildcard, or an implicit type cast all prevent index use.
2. **Nested loop with high loop count.** Usually a bad row estimate upstream. Fix the
   estimate first.
3. **Sort or hash spilling to disk.** Look for "external merge" or "Disk". Either
   reduce the rows before sorting, or raise the working memory setting.
4. **Index scan that still reads most of the table.** The index is not selective enough
   to be worth it. A different column order, or none at all.
5. **Filter removing most rows after fetching them.** The predicate ran after the scan.
   Get it into the index.

## 5. Propose the smallest fix

In order of preference:

1. **Update statistics.** Free, instant, and often sufficient.
2. **Rewrite the query.** Make a predicate sargable, remove a needless DISTINCT, push a
   filter into a subquery. No schema change, no ongoing cost.
3. **Add one index.** Column order matters: equality columns first, then the range
   column, then anything you want covered. One well-ordered composite index usually
   beats three single-column ones.
4. **Change the schema.** Last resort. Say what it costs.

Never propose more than one index at a time. Add it, re-measure, then decide whether
another is still needed. Every index slows writes and takes space, forever.

## 6. Verify

Re-run `EXPLAIN ANALYZE`. Confirm three things:

- The new index is actually used. If it is not, say so, and remove it.
- Actual time improved, and by how much.
- No other node got worse.

Report the before and after as two numbers with the same units, and name what changed.
If the fix did not work, say that plainly rather than reaching for another index.
