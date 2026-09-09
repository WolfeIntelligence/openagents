# Repo Onboarding

Maps an unfamiliar codebase into a working mental model: architecture summary,
entrypoints, directory guide, conventions, and verified run/test instructions. Writes
the result to `ONBOARDING.md` in the repo root so the next person (or agent session)
doesn't have to redo the exploration.

## When to use

- First thing when picking up a codebase you (or the agent) haven't worked in before.
- After joining a new project, to produce a document for the team rather than keeping
  the mental model only in your own head.
- Before a large refactor, to confirm your understanding of entrypoints and
  conventions matches reality.

## Install

```bash
npx openagents add openagents/repo-onboarding
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/repo-onboarding/` |
| `cursor` | `.cursor/rules/repo-onboarding/` |
| `codex` | `.codex/skills/repo-onboarding/` |
| `openai-agents` | `.openai-agents/repo-onboarding/` |
| `generic` | `.openagents/repo-onboarding/` |

## Inputs

| name | type | required | default | description |
|---|---|---|---|---|
| `root_dir` | path | no | `.` | Root directory of the repository to map |
| `depth` | string | no | `standard` | `quick` (structure only), `standard` (+ entrypoints/conventions), or `deep` (+ actually runs install/test) |

## Example run

```
> Onboard me to this repo. Standard depth is fine.
```

The agent reads `README.md`/manifest/CI config, maps the directory structure, finds
entrypoints (HTTP routes, CLI `main`, exported library API), extracts naming and
testing conventions, determines the real install/run/test commands, and writes
`ONBOARDING.md`.

## Files

- `WORKFLOW.md` — the step-by-step procedure (entry point).

## Limitations

- `deep` depth executes install/test commands; only use it in an environment where
  that's safe (e.g. a disposable container or clean checkout), and expect it to take
  longer.
- Best on single-project repos and typical monorepos; unusual/non-standard build
  systems may need manual correction of the generated commands.
- Does not overwrite an existing `ONBOARDING.md` silently — it shows a diff and asks
  first, since a hand-maintained doc may carry context the pass can't infer.
