# Incident Runbook — Workflow

A structured procedure for a production incident: triage, mitigate, communicate, then
postmortem. Timers and escalation rules keep the response moving instead of stalling
on investigation while impact continues.

Inputs: `severity` (required — `sev1`|`sev2`|`sev3`), `incident_channel` (optional),
`escalation_contact` (optional).

## Severity definitions and timers

| Severity | Definition | First status update | Escalate if not mitigated within |
|---|---|---|---|
| **sev1** | Full outage or critical data-integrity risk; all/most users affected | within 5 min | 30 min |
| **sev2** | Major functionality degraded or a significant subset of users affected | within 15 min | 2 hours |
| **sev3** | Minor/limited impact, workaround available | within 60 min | next business day |

Re-classify severity if new information changes the picture (escalate up if impact
turns out wider than first thought; de-escalate down and say so explicitly if it
turns out narrower — don't just quietly stop treating it as urgent).

## Phase 1 — Triage

1. **Confirm it's real.** Check monitoring/alerts against actual user-facing behavior
   before mobilizing a full response — false alarms happen (a broken alert threshold,
   a synthetic check hitting a genuinely-down staging endpoint).
2. **Establish impact.** What's broken, for whom, since when. Prefer concrete signals
   (error rate graph, affected request count) over guesses.
3. **Post the first status update** within the severity's window, using
   `templates/status-update.md`, to `incident_channel` if given. Silence during an
   active incident is worse than an update that just says "still investigating."
4. **Start the incident timeline.** A running, timestamped log of what was observed,
   tried, and found — this becomes the postmortem's factual backbone, so keep it
   contemporaneous rather than reconstructing it afterward.
5. **Form a hypothesis** from recent changes: deploys, config/flag changes, dependency
   upgrades, infra changes, or traffic pattern shifts in the relevant window. Check
   `git log`/deploy history for anything that shipped shortly before impact started —
   correlation here is a strong starting lead, not proof.

## Phase 2 — Mitigate

Priority order: **stop the bleeding before finding root cause.** A fast rollback that
resolves user impact is a better first move than a slow, thorough root-cause
investigation while users are still affected.

1. If a recent deploy/change correlates with the incident start, **roll it back**
   first, and confirm impact actually stops before declaring the rollback the fix
   (correlation ≠ causation — verify).
2. If rollback isn't applicable (e.g. infra failure, third-party outage), consider:
   failover to a backup region/provider, feature-flagging off the affected path,
   scaling up a starved resource, or restarting an unhealthy process — whichever
   restores service fastest with the least additional risk.
3. **Every mitigation action is logged in the timeline** with timestamp and who/what
   performed it, before moving to the next action — this matters both for the
   postmortem and in case the action itself needs to be undone.
4. If the severity's escalation window (see table) passes without mitigation,
   escalate to `escalation_contact` now — don't wait for a "good stopping point."
   Escalating and then resolving it yourself a minute later costs little; not
   escalating on a stuck sev1 costs a lot.
5. Once impact is confirmed resolved (not just "the fix is deployed" — check the
   actual signal that indicated impact), post a mitigation status update and move to
   Phase 3.

## Phase 3 — Communicate

- Status updates go out at the cadence implied by severity: sev1 every 30 min until
  resolved, sev2 hourly, sev3 as material updates occur.
- Use `templates/status-update.md` for consistency: what's known, what's affected,
  what's being done, next update time.
- State facts and current status; avoid speculating on root cause publicly until it's
  confirmed — a wrong public guess has to be walked back and erodes trust more than a
  plain "investigating" would have.
- Post a final resolved update explicitly — don't let updates just trail off.

## Phase 4 — Postmortem

Within a business day or two of resolution (while details are fresh), write the
postmortem using `templates/postmortem.md`. Blameless: focus on what in the system and
process allowed the incident, not who made a mistake — a person following a
reasonable process that still led to an incident is a process/systems finding, not a
personal one.

Every postmortem produces concrete, owned, tracked action items — a postmortem with
only narrative and no action items is incomplete.

## Stop conditions / escalation triggers

- Escalation window from the severity table passes without mitigation → escalate
  immediately per Phase 2.
- Mitigation attempt makes things worse (verified by the impact signal, not
  assumption) → roll back the mitigation itself and escalate; don't keep trying
  variations of a failing approach without a fresh pair of eyes.
- Impact is confirmed fully resolved → move to Phase 3's final update and schedule the
  Phase 4 postmortem; the incident is not "done" until the postmortem's action items
  are filed (even if not yet completed).
