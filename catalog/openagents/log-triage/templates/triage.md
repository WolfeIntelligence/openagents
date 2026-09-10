# Triage: <symptom>

## Symptom

<One sentence, observable terms. What, to whom, from when.>

## Timeline

| Time (UTC) | Event | Source |
|---|---|---|
| | First occurrence | |
| | Rate change | |
| | Coinciding change (deploy, flag, config) | |

**Shape:** <constant / growing / spiky / step change>

## Error groups

| Shape | Count | First seen | Last seen | Background? |
|---|---|---|---|---|
| | | | | |

## One traced request

<Correlation id. The sequence across services, ending at the first thing that actually
went wrong, not the last thing logged.>

## Hypotheses

### 1. <Claim> — <confidence>

- **For:** <evidence>
- **Against:** <evidence>
- **Does not explain:** <any fact it fails to cover>
- **Cheapest test:** <what to run, and what result would confirm or kill it>

### 2. <Claim> — <confidence>

### 3. <Claim> — <confidence>

## Next action

<The single cheapest discriminating test, and what you expect it to show.>

## Known unknowns

<What you could not see: missing logs, gaps in retention, services with no tracing.>
