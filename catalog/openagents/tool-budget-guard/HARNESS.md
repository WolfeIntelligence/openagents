# Tool Budget Guard

Three budgets, checked continuously, with a defined ending when one runs out.

## The budgets

| Budget | Guards against | Default |
|---|---|---|
| Tool calls | Loops and thrash | `max_tool_calls` (40) |
| Wall clock | Hangs and slow crawls | `max_wall_clock_s` (900) |
| Tokens | Context bloat, cost | 70% of the context window |

Track all three from the first step. Report them at the end whether or not one was
hit. A task that finished at 38 of 40 tool calls was nearly a runaway, and you only
learn that if the number is visible.

## Checkpoints

Every 25% of the largest budget, stop and answer in one line each:

1. What have I actually established since the last checkpoint?
2. Is the remaining budget enough to finish?
3. If not, what is the smallest useful thing I can deliver with what is left?

Answer 1 being "nothing" twice in a row is a stuck loop. Escalate immediately rather
than waiting for the ceiling.

## Detecting a loop before the budget dies

Three signals, any one of which means stop:

- **Repeated call.** The same tool with the same arguments twice in a row.
- **Repeated error.** The same error text three times, however you varied the call.
- **No new facts.** Two consecutive checkpoints where question 1 is empty.

The response to a loop is never "try once more." It is to change approach or escalate.

## When a budget is exhausted

Follow `on_exhausted`:

- **report** (default). Stop and deliver partial work. Say what you established, what
  you did not, what you would do next, and which budget ran out. Never present partial
  work as complete.
- **ask.** Same report, then request more budget with a specific number and a reason:
  "another 20 calls to check the two remaining candidates."
- **abort.** Stop and roll back any partial side effects you own. Use this where a
  half-finished state is worse than nothing: migrations, deploys, bulk writes.

Whatever the mode, never silently continue past a budget. A budget you can quietly
exceed is not a budget.

## Interaction with retries

Retries spend budget. Count them. A retry policy and a budget that do not know about
each other will burn the whole allowance on one failing call. Cap retries at 3 per
distinct operation and count each against `max_tool_calls`.
