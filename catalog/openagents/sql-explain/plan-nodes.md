# Common plan nodes

## Scans

**Seq Scan / Table Scan** - reads every row. Correct for a small table or a query that
genuinely wants most rows. A problem when the table is large and the predicate is
selective.

**Index Scan** - walks the index, then fetches each matching row from the table. Good
when few rows match. Each fetch is a random read, so it loses to a sequential scan past
roughly 5 to 10% of the table.

**Index Only Scan** - answers entirely from the index, no table fetch. The fastest
shape. Requires every referenced column to be in the index.

**Bitmap Heap Scan** - collects matching locations from the index, sorts them, then
reads the table in physical order. The planner's compromise between the two above.
Normal for medium selectivity.

## Joins

**Nested Loop** - for each outer row, scan the inner side. Excellent when the outer
side is genuinely tiny. Catastrophic when the estimate was wrong. Always check
`loops`.

**Hash Join** - builds a hash table from one side, probes with the other. The usual
choice for large unsorted joins. Watch for the build side spilling to disk.

**Merge Join** - both sides sorted, then merged. Good when the inputs are already
sorted, for example by an index. Watch for a sort node feeding it.

## Blocking nodes

**Sort** - look for the method. In-memory quicksort is fine. "external merge Disk"
means it spilled, and is worth fixing.

**Aggregate / HashAggregate / GroupAggregate** - Hash is usually faster but needs
memory. Group needs sorted input.

**Materialize** - caches a subplan's output for repeated reads. Often paired with a
nested loop.

## Reading tips

- `rows=N` in the estimate is per loop, not total.
- `actual time=x..y` is start time and end time, per loop.
- The `Filter` line under a scan shows a predicate applied after reading. `Rows Removed
  by Filter` on that line is wasted work you can often move into an index.
- Buffer counts distinguish a cold cache from a genuinely expensive plan. A slow first
  run and a fast second run is a caching story, not a planning one.
