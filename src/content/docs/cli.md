---
title: CLI
description: Every openagents CLI command — add, search, info, init, validate, publish, list, remove.
order: 5
---

# CLI

`openagents` is a standalone npm package (zero runtime dependencies besides `tar`,
Node.js 18+) for installing, searching, and scaffolding OpenAgents packages from the
command line. Every request it makes sends `User-Agent: openagents-cli/<version>` so
the registry can attribute installs.

```bash
npx openagents --help
# or install it globally:
npm install -g openagents
```

An unrecognized global or command flag is an error (`unknown option: --foo`), not a
silent no-op.

## `openagents add <owner/name>`

Downloads a package and installs it into the right directory for your runtime,
generating a runtime-specific discovery shim so the target runtime actually picks it
up (not just a directory of files) — see [Runtimes](/docs/runtimes) for the full
per-runtime breakdown.

```bash
openagents add openagents/pr-reviewer
openagents add openagents/pr-reviewer --runtime claude-code
openagents add openagents/pr-reviewer --dir ./my-project
```

`owner/name@version` is accepted as a ref (e.g. `openagents/pr-reviewer@1.2.0`), but
the registry doesn't support fetching a pinned historical version yet — `add` parses
the version, warns that it's ignored, and installs the current `latest` instead.

| Flag | Description |
|---|---|
| `--runtime <id>` | One of `claude-code`, `cursor`, `codex`, `openai-agents`, `langgraph`, `generic`. Auto-detected when omitted — see [Runtimes](/docs/runtimes). |
| `--registry <url>` | Registry base URL. Defaults to `OPENAGENTS_REGISTRY` or `https://openagents-nu.vercel.app`. |
| `--dir <path>` | Project root to install into. Defaults to the current directory. |
| `--json` | Print the result as JSON instead of human-readable text. |

Under the hood: `GET /api/v1/packages/{owner}/{name}` for the manifest, then
`GET /api/v1/packages/{owner}/{name}/download?runtime=<id>` for the tarball, extracted
into the runtime's install directory, followed by writing that runtime's shim (a
`SKILL.md` with frontmatter, a `.cursor/rules/<name>.mdc` file, etc.) After installing,
`add` prints a runtime-specific "next step" hint — e.g. restart Claude Code, or check
`.cursor/rules/` picked it up — and records the install in `.openagents/installed.json`
(see **Lockfile** below).

If the package is paid and you haven't purchased it, `add` fails with the server's
`402` reason surfaced directly (not a raw HTTP error) and prints the package's page URL
so you can buy it in the browser: buying from the CLI itself isn't supported yet.

## `openagents list`

Lists packages installed into the current project (or `--dir`), reading
`.openagents/installed.json`.

```bash
openagents list
openagents list --dir ./my-project
openagents list --json
```

Shows package id, installed version, runtime, and install path for each entry.

## `openagents remove <owner/name>`

Removes an installed package's files and its runtime shim, and drops it from the
lockfile.

```bash
openagents remove openagents/pr-reviewer
```

| Flag | Description |
|---|---|
| `--dir <path>` | Project root. Defaults to the current directory. |

Fails clearly if the package isn't in `.openagents/installed.json` rather than
silently doing nothing.

## `openagents search <query>`

```bash
openagents search "code review"
openagents search "code review" --json
```

Calls `GET /api/v1/search?q=<query>` and prints a table: package id, kind, version,
price, stars, summary, followed by a `Showing N of TOTAL` line so it's clear when
results are truncated by the endpoint's page size.

| Flag | Description |
|---|---|
| `--json` | Print `{ items, total }` as JSON instead of a table. |

## `openagents info <owner/name>`

```bash
openagents info openagents/pr-reviewer
openagents info openagents/pr-reviewer --json
```

Prints the full manifest — kind, license, tags, runtimes, pricing, entry file, file
list, declared inputs — plus download/star stats. For a paid package, also prints the
package's page URL to buy it. `--json` prints the raw package response instead.

## `openagents init`

Scaffolds a new package, no interactive prompts (flag-driven, so it's script-friendly):

```bash
openagents init \
  --kind workflow \
  --name my-workflow \
  --title "My Workflow" \
  --summary "Does the thing." \
  --tags automation,example \
  --runtimes claude-code,generic \
  --version 2.3.1
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

`--version` writes the value you pass into the generated manifest's `version` field
(previously a bug let the global `-v`/`--version` flag hijack this and write the
literal value `true` instead — fixed: `--version` is only treated as the global
version flag when it's the command itself, e.g. `openagents --version` or
`openagents init` with no other arguments).

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

This is a local, offline check — it doesn't apply the registry-only rules from
[Package Format](/docs/package-format) (file size/count limits, owner-matches-handle,
version-must-increase), which only the server enforces at publish time.

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

## Lockfile: `.openagents/installed.json`

`add`, `list`, and `remove` all read/write a lockfile at `.openagents/installed.json`
in the project root (or `--dir`), recording each installed package's id, version,
runtime, and install path. It's local, plain JSON, and safe to commit if you want
`openagents list` to reflect what's checked in.

## Configuration

| Env var | Purpose |
|---|---|
| `OPENAGENTS_REGISTRY` | Default registry base URL for every command; overridden per-invocation by `--registry`. |

## Global flags

`-h` / `--help` prints usage. `-v` / `--version` prints the installed CLI version.
`--json`, where supported (`search`, `info`, `add`, `list`), prints machine-readable
output instead of formatted text.
