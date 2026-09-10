# Blameless Postmortem

## 0. Wait until the incident is over

A postmortem written during an incident is a status update. Wait until the system is
stable, and hold it within about a week, while memory is fresh and interest survives.

## 1. Build the timeline from evidence

Not from memory. Memory reorders events to fit the explanation people arrived at.

Sources, in order of reliability: monitoring and logs with timestamps, deploy and
change records, the incident channel with its own timestamps, then interviews.

Record for each entry: time in UTC, what happened, and how you know. Include:

- When the fault was introduced, which is often long before the incident.
- When it began affecting users. This is when the incident started, not when it was noticed.
- When it was detected, and by what. A customer report means detection failed.
- Each mitigation attempt, including the ones that did not work.
- When impact ended, and when it was confirmed ended.

The gaps between introduced, started, detected and resolved are the most useful numbers
in the document. Each one is a different problem with a different fix.

## 2. Establish impact in numbers

Who, how many, how long, how much. "Some users saw errors" is not impact. "About 3% of
checkout requests failed for 47 minutes, roughly 1,200 orders" is impact, and it is what
justifies the effort of the fixes.

Include what you cannot measure, and say why you cannot. That gap is often itself an
action item.

## 3. Find contributing factors, not a root cause

Almost no real incident has one cause. It has a chain, and every link is a place it
could have been stopped.

For each step in the chain ask: what made this possible, and what would have caught it?

Look in four places:

- **Technical.** The bug, the missing limit, the untested path.
- **Detection.** Why did monitoring not catch it, or catch it sooner?
- **Response.** What slowed diagnosis? A missing runbook, an unclear owner, a dashboard
  nobody could find.
- **Systemic.** What made this class of mistake easy to make? A confusing interface, a
  deploy process with no staging, review that cannot catch this kind of error.

## 4. Stay blameless, which is a technique and not a courtesy

Whenever a sentence names a person, rewrite it to name the condition that let the action
have that consequence.

- Not "Sam deployed without running migrations."
- But "the deploy pipeline allowed a deploy to proceed with pending migrations."

The second is fixable. The first is only embarrassing. **Assume everyone acted
reasonably given what they knew at the time**, then ask why the wrong action looked
right. That question always has a systemic answer.

Also resist counterfactuals. "If only they had checked the dashboard" is not a finding.
Nobody knew to check it. Ask why the dashboard did not come to them.

## 5. Write actions that will actually be done

Every action needs an owner who is a named person, a date, and a definition of done that
someone else could verify.

Prioritize by what breaks the chain closest to the start. In order:

1. Make the failure impossible.
2. Make it detected automatically, and sooner.
3. Make it faster to diagnose.
4. Make it faster to mitigate.

Cap the list at what will genuinely be completed. Five actions that ship beat fifteen
that decorate a document. Delete anything you are not honestly going to do, rather than
leaving it there to be quietly abandoned.

An action that is only "add more monitoring" or "be more careful" is not an action.

## 6. Circulate and follow up

Publish where people outside the incident can read it. Review the actions on a schedule.
An unreviewed action list is how the same incident happens twice, and the second
postmortem has to explain why the first one changed nothing.
