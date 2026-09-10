# SQL Safety Rules

## Writes

1. **Never write an UPDATE or DELETE without a WHERE clause.** If you truly mean every
   row, say so explicitly in a comment on the line above and get it approved.
2. **Count before you write.** Run the SELECT with the same WHERE first and check the
   row count against what you expect. A number two orders of magnitude off means the
   predicate is wrong.
3. **Wrap multi-statement writes in a transaction**, and know whether your DDL is
   transactional. In Postgres it mostly is. In MySQL it mostly is not.
4. **Bound every bulk write.** Delete or update in batches with a LIMIT and a loop, not
   in one statement that locks a million rows.
5. **Never write to production from an interactive session** when a reviewed migration
   would do.

## Reads

6. **Every query on a large table needs an index-supported predicate.** Check the plan.
   A sequential scan in a hot path is a future incident.
7. **No SELECT * in application code.** It breaks silently when a column is added and
   ships columns you do not need over the wire.
8. **Paginate by a stable key, not by OFFSET.** OFFSET on a large table gets slower the
   deeper it goes, and skips rows when data shifts underneath it.

## Migrations

9. **Every migration needs a down, or an explicit note that it is irreversible** and
   why that is acceptable.
10. **Adding a NOT NULL column with a default rewrites the table** on older engines.
    Add nullable, backfill in batches, then add the constraint.
11. **Never rename or drop a column in the same deploy that stops using it.** Ship the
    code that ignores it, deploy, then drop in a later migration. Otherwise the old
    running version breaks the instant the migration lands.
12. **Create indexes concurrently** where the engine supports it. A plain CREATE INDEX
    takes a write lock for the duration.
13. **Backfill outside the migration**, in batches, with a resumable cursor. A backfill
    inside a migration holds a lock for as long as it runs.

## Injection and identity

14. **Parameterize every value. Always.** String interpolation into SQL is the bug, even
    when the input "cannot" contain a quote.
15. **Identifiers cannot be parameterized**, so validate table and column names against
    an allowlist rather than passing them through.

## Before running anything against production

16. **Know the row count** the statement will touch.
17. **Know the lock** it takes and for how long.
18. **Know the rollback.** If it is a restore from backup, know how long the restore
    takes and say so out loud before running.
