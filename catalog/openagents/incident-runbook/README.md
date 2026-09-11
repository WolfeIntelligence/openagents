# Incident Runbook

A structured incident-response workflow: triage, mitigate, communicate, postmortem —
with severity-based timers (first update / escalation window) so response doesn't
stall, and templates for status updates and a blameless postmortem with tracked action
items.

## When to use

- An agent is on-call or assisting on-call and a production incident needs a
  consistent response process instead of ad-hoc investigation.
- Standardizing incident communication cadence across a team.
- Writing up a postmortem after an incident is resolved, with a template that forces
  concrete action items instead of just narrative.

## Install

```bash
npx openagents-cli add openagents/incident-runbook
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/incident-runbook/` |
| `codex` | `.codex/skills/incident-runbook/` |
| `generic` | `.openagents/incident-runbook/` |

## Inputs

| name | type | required | default | description |
|---|---|---|---|---|
| `severity` | string | yes | — | `sev1` (critical/full outage), `sev2` (major/degraded), `sev3` (minor/limited impact) |
| `incident_channel` | string | no | — | Chat channel/thread to post status updates to |
| `escalation_contact` | string | no | — | Who/what to page if not mitigated within the severity's window |

## Example run

```
> We're seeing 500s on checkout for ~30% of traffic. Sev1. Run the incident runbook.
```

The agent confirms impact against real signals, posts a first status update within 5
minutes (sev1 window), builds a timestamped timeline, checks recent deploys for a
correlated change, prioritizes rollback over root-cause investigation, escalates if the
30-minute sev1 window passes without mitigation, and — once resolved — schedules a
blameless postmortem with owned action items.

## Files

- `WORKFLOW.md` — triage/mitigate/communicate/postmortem procedure with severity
  timers and escalation rules (entry point).
- `templates/status-update.md` — status update format (investigating/mitigating/
  monitoring/resolved).
- `templates/postmortem.md` — blameless postmortem template with a required action
  items table.

## Limitations

- Timers and escalation windows are defaults from the severity table — adjust them in
  `WORKFLOW.md` to match your team's actual SLOs before relying on them.
- Assumes the agent has (or a human operator provides) access to deploy history,
  monitoring signals, and rollback/failover mechanisms; it doesn't grant that access.
- Escalation (paging `escalation_contact`) and posting to `incident_channel` are
  side-effectful — confirm the target before the agent sends anything on your behalf.
