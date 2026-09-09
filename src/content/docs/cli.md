---
title: CLI
description: Every openagents CLI command — add, search, info, init, validate, publish.
order: 5
---

# CLI

`openagents` is a standalone npm package (zero runtime dependencies besides `tar`,
Node.js 18+) for installing, searching, and scaffolding OpenAgents packages from the
command line.

```bash
npx openagents --help
# or install it globally:
npm install -g openagents
```

## `openagents add <owner/name>`

Downloads a package and installs it into the right directory for your runtime.

```bash
openagents add openagents/pr-reviewer
openagents add openagents/pr-reviewer --runtime claude-code
openagents add openagents/pr-reviewer --dir ./my-project
```

| Flag | Description |
|---|---|
| `--runtime <id>` | One of `claude-code`, `cursor`, `codex`, `openai-agents`, `langgraph`, `generic`. Auto-detected when omitted — see [Runtimes](/docs/runtimes). |
| `--registry <url>` | Registry base URL. Defaults to `OPENAGENTS_REGISTRY` or `https://openagents-nu.vercel.app`. |
| `--dir <path>` | Project root to install into. Defaults to the current directory. |

Under the hood: `GET /api/v1/packages/{owner}/{name}` for the manifest, then
`GET /api/v1/packages/{owner}/{name}/download` for the tarball, extracted into the
runtime's install directory.

## `openagents search <query>`

```bash
openagents search "code review"
```

Calls `GET /api/v1/search?q=<query>` and prints a table: package id, kind, version,
price, stars, summary.

## `openagents info <owner/name>`

```bash
openagents info openagents/pr-reviewer
```

Prints the full manifest — kind, license, tags, runtimes, pricing, entry file, file
list, declared inputs — plus download/star stats.

## `openagents init`

Scaffolds a new package, no interactive prompts (flag-driven, so it's script-friendly):

```bash
openagents init \
  --kind workflow \
  --name my-workflow \
  --title "My Workflow" \
  --summary "Does the thing." \
  --tags automation,example \
  --runtimes claude-code,generic
```

| Flag | Default |
|---|---|
| `--kind` | `workflow` (`workflow` \| `harness` \| `rules` \| `skill`) |
| `--name` | current directory's basename, slugified |
| `--owner` | `me` |
| `--title` | title-cased `--name` |
| `--summary` | a `TODO:` placeholder |
| `--license` | `MIT` |
| `--version` | `1.0.0` |
| `--tags` | none |
| `--runtimes` | `claude-code,generic` |
| `--dir` | current directory |
| `--force` | off — refuses to overwrite existing files |

Writes `openagent.yaml`, `README.md`, and the kind-appropriate entry file
(`WORKFLOW.md` / `HARNESS.md` / `RULES.md` / `SKILL.md`) as a starting skeleton.

## `openagents validate [dir]`

```bash
openagents validate ./catalog/openagents/pr-reviewer
```

Hand-written checks (no schema library — the CLI ships dependency-free apart from
`tar`) against `openagent.yaml` in `dir` (default: current directory):

- Required keys present with correct types.
- `name`/`owner` match `^[a-z0-9-]{2,64}$`; `version` is valid semver.
- `kind`, `runtimes`, `pricing.model`, and every `inputs[].type` are recognized values.
- `pricing.amount_cents` is non-negative, and `> 0` whenever `pricing.model` isn't
  `free`.
- `entry` is listed in `files`.
- Every path in `files` (and `entry`) actually exists on disk.
- `README.md` exists alongside the manifest.

Exits with a non-zero status and a list of issues if anything fails; prints a one-line
confirmation (kind, entry, file count) on success.

## `openagents publish`

```bash
openagents publish
```

Publishing directly from the CLI is not implemented yet — the command prints where to
go instead: the hosted publish flow (`<registry>/publish`), the raw API
(`POST /api/v1/publish`), or — for free packages — how to open a PR against
`catalog/<owner>/<name>/`. See [Publishing](/docs/publishing).

## Configuration

| Env var | Purpose |
|---|---|
| `OPENAGENTS_REGISTRY` | Default registry base URL for every command; overridden per-invocation by `--registry`. |

## Global flags

`-h` / `--help` prints usage. `-v` / `--version` prints the installed CLI version.
