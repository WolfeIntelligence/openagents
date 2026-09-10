# Context Compaction

## Compact on a threshold, not on an error

Trigger at `compact_at` percent of the window (default 70), or at a natural seam:
a subtask finished, a phase changed, a test suite went green. Compacting at 95% is
already too late, the degradation happened in the last 25%.

## What always survives

In priority order. If you can only keep one thing, keep the first.

1. **The goal**, in the user's own words. Not your paraphrase of it, which drifts.
2. **Decisions and their reasons.** "Chose Postgres over SQLite because the deploy
   target is multi-instance." A decision without its reason gets re-litigated.
3. **Constraints discovered the hard way.** The API that rate-limits at 10/s, the test
   that only passes with the flag, the file that must not be touched.
4. **Current state.** What is done, what is in progress, what is untouched.
5. **Open questions**, and what would answer each.

## What does not survive

- Full file contents. Keep the path and one line on what it does. Re-read on demand.
- Tool output you already extracted the answer from.
- Failed approaches, except one line naming the approach and why it failed. That line
  is what stops you trying it again.
- Your own reasoning. Keep conclusions.
- Anything you would not write down if a colleague were taking over.

## The test for a good checkpoint

Someone who has never seen the transcript reads only your checkpoint and continues
the work correctly. If they would have to ask a question you already know the answer
to, that answer belongs in the checkpoint.

Write it in `templates/checkpoint.md` format, to a real file. A checkpoint that lives
only in context does not survive the thing it exists to survive.

## Resuming

On resume, read the checkpoint before doing anything else, then verify the state it
claims rather than trusting it. Files change between sessions. Confirm the three or
four facts the next step depends on, cheaply, then continue.

If verification contradicts the checkpoint, the world wins. Note the discrepancy and
update the checkpoint before proceeding.

## What breaks and how to notice

- **Goal drift.** You are now solving a subproblem, well, that nobody asked for.
  Re-read the goal line at every compaction.
- **Decision amnesia.** You reconsider a settled choice. If the checkpoint had the
  reason, this does not happen.
- **Re-reading loops.** You read the same file for the third time. Its summary line
  was too thin. Fix the line, not the loop.
