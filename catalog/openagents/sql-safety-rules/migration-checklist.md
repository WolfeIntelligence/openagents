# Migration review

Answer every question before the migration is approved. "Probably fine" is not an
answer to any of them.

## Blast radius

- [ ] How many rows does this touch?
- [ ] What lock does each statement take, and for how long?
- [ ] What happens to in-flight queries during that lock?
- [ ] Is the busiest table involved? At what time will this run?

## Compatibility

- [ ] Does the currently deployed application version still work after this lands?
- [ ] Does the new version work before it lands?
- [ ] If the answer to either is no, this migration must be split.

## Reversibility

- [ ] Is there a down migration? Has it been run against a copy?
- [ ] If irreversible, is that written down, and is the reason acceptable?
- [ ] What is the recovery path if it fails halfway?

## Data

- [ ] Is any data destroyed? Is it backed up somewhere that is not this database?
- [ ] Is the backfill batched and resumable?
- [ ] What happens if the backfill is interrupted at 50%?

## Rehearsal

- [ ] Has this run against a restored production-sized copy?
- [ ] How long did it take there?
