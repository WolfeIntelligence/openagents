# Migration Review

## 1. Read what it actually does

List every statement and what each one touches. Watch for the ones that hide work:

- A `NOT NULL` addition with a default may rewrite the whole table.
- A type change may rewrite the whole table.
- An added foreign key takes a lock on both tables and validates every existing row.
- A plain `CREATE INDEX` holds a write lock for the whole build.

## 2. Blast radius

For each statement, answer with a number, not an adjective:

- How many rows does it touch?
- What lock does it take, and on what?
- How long will it hold that lock, at production size?
- What queries block behind that lock, and what happens to them? A blocked query
  usually means a timeout, then a retry storm, then an outage that looks unrelated.

If you cannot answer the timing question, the migration has not been rehearsed and is
not ready to approve.

## 3. Deploy compatibility

The single most common cause of a migration incident. During a deploy, the old code and
the new schema coexist, in both orders.

Answer both:

- Does the **currently deployed** code still work **after** this migration?
- Does the **new** code work **before** it?

If either is no, the change must be split across releases. The general pattern is
expand, migrate, contract:

1. **Expand.** Add the new thing. Nothing reads it yet.
2. **Migrate.** Backfill, then move readers and writers over.
3. **Contract.** Remove the old thing, in a later deploy.

Each of these three is a separate, independently deployable change.

## 4. Backfills

A backfill inside a migration holds a transaction open for its whole duration. Take it
out.

- Batch it, with a bounded size per batch and a pause between.
- Make it resumable from a cursor, so an interruption at 60% is not a restart.
- Make it idempotent, so a rerun is harmless.
- Run it separately from the schema change, and monitor it.

## 5. Rollback

- Is there a down migration, and has it actually been run against a copy?
- If the change is irreversible, is that written down and accepted?
- What is the recovery path if the migration fails halfway through? Know whether your
  engine wraps DDL in a transaction. Postgres largely does. MySQL largely does not, so a
  half-applied migration is a real state you must plan for.
- If the answer is "restore from backup", know how long a restore takes and say that out
  loud before approving.

## 6. Rehearse

Run it against a restored copy at production scale. Record how long it took. A
migration that has never been rehearsed at real size is an estimate, and estimates of
lock duration are consistently wrong in the unsafe direction.

## 7. Approve with the numbers attached

State the row count, the lock, the rehearsed duration, the deploy ordering, and the
rollback. An approval without those five is a guess with a signature on it.
