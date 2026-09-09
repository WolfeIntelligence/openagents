# Status Update Template

Post at the cadence implied by severity (see `WORKFLOW.md` Phase 3). Keep it factual
and brief — this is read by people who need the current state, not the investigation
narrative.

```markdown
**[<severity>] <one-line incident title>** — <INVESTIGATING | MITIGATING | MONITORING | RESOLVED>

**Impact:** <what's broken, for whom, since when — concrete, not vague>
**Current status:** <what's known right now, in plain language>
**Actions in progress:** <what's actively being done>
**Next update:** <time, per the severity cadence>
```

### Resolved update

```markdown
**[<severity>] <title>** — RESOLVED

**Resolution:** <what fixed it, when impact actually stopped (verified, not assumed)>
**Duration:** <start time> to <resolution time>
**Postmortem:** <link, or "to follow within 1 business day">
```

## Guidance

- Never speculate on root cause in a status update before it's confirmed — "we believe
  this may be related to X, still confirming" is fine; presenting a guess as fact is
  not.
- If severity is re-classified mid-incident, say so explicitly in the next update
  ("upgrading this to sev1 — impact is broader than initially assessed") rather than
  silently changing the cadence.
- A resolved update is not optional — always post one, even if it's brief.
