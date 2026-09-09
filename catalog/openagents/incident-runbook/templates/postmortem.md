# Postmortem Template

Blameless. Focus on system/process causes, not individual blame. Every postmortem ends
with owned, tracked action items — a postmortem without action items is incomplete.

```markdown
# Postmortem: <incident title>

**Date:** <date>          **Severity:** <sev1/2/3>          **Duration:** <start> – <end> (<total time>)
**Author(s):** <who wrote this>          **Status:** Draft | Reviewed | Final

## Summary

<2-4 sentences: what happened, what was the user-facing impact, how was it resolved.
 Should be understandable by someone outside the team.>

## Impact

- <who/what was affected, quantified where possible: error rate, affected user count,
  duration of degradation, any data impact>

## Timeline

<Pull from the contemporaneous incident-timeline log kept during the response.
 All times in one consistent timezone, clearly labeled.>

| Time | Event |
|---|---|
| HH:MM | <first signal — alert fired, user report, etc.> |
| HH:MM | <detection — when someone confirmed it was real> |
| HH:MM | <key investigation step or finding> |
| HH:MM | <mitigation action taken> |
| HH:MM | <impact confirmed resolved> |

## Root cause

<the actual mechanism — not just "a bug," but what specifically: e.g. "a config
 change removed a required env var validation, causing the service to start with
 a null database URL and silently no-op writes." Distinguish root cause from
 contributing factors below.>

## Contributing factors

<things that made this worse, slower to detect, or slower to mitigate than it
 should have been — e.g. "no alert existed for this failure mode," "the rollback
 required a manual step that wasn't documented." These are usually where the best
 action items come from.>

## What went well

<detection speed, an existing runbook that worked, a mitigation that worked cleanly —
 worth naming so it's reinforced, not just what went wrong.>

## Action items

| Action | Owner | Priority | Tracking link |
|---|---|---|---|
| <specific, concrete action — not "improve monitoring" but "add alert for X metric threshold Y"> | <name> | P0/P1/P2 | <issue link> |

## Blameless note

This document focuses on systems and processes, not individuals. If a person's action
is mentioned, it's to describe what information/tooling/process would have led to a
different outcome — not to assign fault.
```
