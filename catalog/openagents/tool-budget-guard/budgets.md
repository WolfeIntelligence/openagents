# Setting the numbers

Start from the task shape, then tune from real runs. These defaults are deliberately
tight. A budget nobody ever hits is not doing any work.

| Task shape | Tool calls | Wall clock | Notes |
|---|---|---|---|
| Answer a question about a repo | 10 | 120s | Mostly reads. More than this means the search is wrong. |
| Fix a well-specified bug | 40 | 900s | Read, edit, test, iterate once or twice. |
| Open-ended investigation | 80 | 1800s | Wide search phase. Checkpoint hard. |
| Bulk mechanical edit | 25 plus 2 per file | 60s plus 10s per file | Scale with the work, not a flat cap. |
| Autonomous or unattended | 60 | 600s | Tighter than attended: no one will notice a loop. |

## Tuning from real runs

1. Log actual usage on every run, not just on failures.
2. Set the budget near the 90th percentile of successful runs, plus a little.
3. If more than about 5% of runs hit the ceiling, the budget is too tight or the task
   is underspecified. Find out which before raising it.
4. If no run has come near the ceiling in a month, lower it. You are not protected by
   a limit you never approach.

## What not to do

- Do not raise a budget because a run hit it. Find out why first. Nine times in ten it
  is a loop, and a bigger budget just makes a longer loop.
- Do not make budgets per-tool. Agents route around a per-tool cap by using a
  different tool. Cap the total.
- Do not exempt "just one more check." That is the loop talking.
