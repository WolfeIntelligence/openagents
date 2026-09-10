# Agent Eval Harness

Builds an eval suite that can actually catch a regression. The output is a case file,
a grader per case type, a recorded baseline, and a gate that fails a change which
makes things worse.

## 0. Decide what better means, before looking at any output

Write down the one or two things this agent must get right, in a sentence each. If you
cannot state them, you cannot grade them, and the eval will drift into measuring
whatever is easy to measure.

Bad: "responses are high quality."

Good: "the cited file path exists in the repo" and "the fix compiles."

## 1. Collect cases from reality, not imagination

Aim for `n_cases` (default 30). A suite of 30 real cases beats 300 synthetic ones.
In priority order:

1. **Bugs.** Every reported failure becomes a case, with the expected behavior as the
   report described it. These are the highest-value cases you will ever have.
2. **Production traffic.** Sample real inputs. Stratify. Take some from the head and
   some from the tail, not 30 of the same shape.
3. **Known-hard cases.** Inputs already near the edge of capability.
4. **Synthetic cases, last.** Only to cover a branch the first three missed.

Record each case in the `templates/cases.jsonl` format. Every case needs an `id`, an
`input`, and enough of an `expected` to grade against.

## 2. Split the suite

- **dev** (about 60%): you look at these, iterate against them, and overfit them. Fine.
- **held-out** (about 40%): you do not look at individual outputs, only the aggregate.

Report both numbers, always. A dev score that climbs while held-out stays flat means
you tuned to the cases, not the task.

## 3. Write a grader per case type

See `grading.md`. The rule that matters: a grader that cannot judge a case must return
`unknown`, never `pass`. Silent passes are how eval suites rot into decoration. Track
`unknown` as its own bucket and drive it toward zero.

## 4. Take a baseline before changing anything

Run the current version against the full suite and record:

- pass, fail and unknown counts, for dev and held-out separately
- the score per case type, not just the total
- cost and p50/p95 latency per case
- the run date, model id, and prompt version

Commit this. A baseline you cannot reproduce is a rumor.

## 5. Gate changes on it

A change ships when held-out pass rate does not drop and no case type regresses. Two
rules make this survive contact with reality:

- **Investigate every newly failing case individually.** A steady aggregate can hide
  two cases breaking while two unrelated ones start passing.
- **A flaky case is a bug in the case or the grader.** Run the suite twice against an
  unchanged target. Anything that flips is not measuring the target. Fix it or drop it.

## 6. Keep it alive

- Add the case first when a bug is reported, and watch it fail. Then fix.
- Re-baseline on a model or major prompt change, and note why in the commit.
- Prune cases that have never once failed and never will.

## Reporting

State the score honestly:

> held-out 24/30 pass, 4 fail, 2 unknown (baseline: 22/30, 6 fail, 2 unknown).
> Regression on tool-choice cases: 3/5 down to 2/5.

Never report a single percentage with no denominator, no held-out split, and no
unknown count. That number is unfalsifiable and therefore useless.
