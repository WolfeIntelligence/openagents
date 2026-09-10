# Safe recipes

## Add a NOT NULL column

Unsafe: `ADD COLUMN x text NOT NULL DEFAULT 'a'` on an old engine rewrites the table.

Safe:

1. Add the column nullable, no default.
2. Deploy code that writes it on every new row.
3. Backfill existing rows in batches.
4. Add the `NOT NULL` constraint, validated separately where the engine allows.

## Rename a column

Never rename in place while code is running.

1. Add the new column.
2. Deploy code that writes both and reads the new one, falling back to the old.
3. Backfill.
4. Deploy code that only uses the new one.
5. Drop the old column, in a later release.

## Drop a column

1. Deploy code that never reads or writes it. Confirm in production over some days.
2. Drop it.

Never in one step. The old running instances will still be selecting it.

## Add an index

Use the concurrent form where available.

```sql
CREATE INDEX CONCURRENTLY idx_name ON table (col);
```

It cannot run inside a transaction, takes longer, and can leave an invalid index if it
fails. Check validity afterwards and drop and retry if needed.

## Change a column type

Usually a table rewrite. Treat it as a rename:

1. Add a new column of the new type.
2. Dual-write.
3. Backfill in batches.
4. Switch reads.
5. Drop the old column later.

## Add a foreign key

Adding it validated locks both tables while it checks every row.

1. Add the constraint `NOT VALID`. It applies to new rows only, and takes a brief lock.
2. `VALIDATE CONSTRAINT` separately. This takes a weaker lock and can run for a while.

## Delete a lot of rows

Never one statement.

```sql
-- Repeat until zero rows affected, pausing between batches.
DELETE FROM t WHERE id IN (
  SELECT id FROM t WHERE <predicate> LIMIT 5000
);
```

Watch replication lag between batches, and stop if it grows.
