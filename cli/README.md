# openagents

The command-line client for [OpenAgents](https://openagents.vercel.app), an
open-source marketplace for agentic workflows, harnesses, rules, and skills.
Install packages into your project's runtime (Claude Code, Cursor, Codex CLI,
OpenAI Agents SDK, LangGraph, or a generic layout), search the catalog, and
scaffold new packages.

Standalone package — zero runtime dependencies besides
[`tar`](https://www.npmjs.com/package/tar). Requires Node.js 18+ (uses the
built-in `fetch`).

## Install

```bash
npm install -g openagents
# or run without installing:
npx openagents --help
```

## Commands

### `openagents add <owner/name>`

Downloads a package from the registry and installs it into the right directory
for your project's runtime.

```bash
openagents add openagents/pr-reviewer
openagents add openagents/pr-reviewer --runtime claude-code
openagents add openagents/pr-reviewer --dir ./my-project --registry https://my-registry.example.com
```

Flags:
- `--runtime <id>` — one of `claude-code`, `cursor`, `codex`, `openai-agents`,
  `langgraph`, `generic`. If omitted, the runtime is auto-detected by looking
  for `.claude/`, `.cursor/`, `.codex/`, `.openai-agents/`, `.langgraph/` in
  the target directory, falling back to `generic`.
- `--registry <url>` — registry base URL. Defaults to `OPENAGENTS_REGISTRY` or
  `https://openagents.vercel.app`.
- `--dir <path>` — project root to install into. Defaults to the current
  directory.

Install directory per runtime:

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/<name>/` |
| `cursor` | `.cursor/rules/<name>/` |
| `codex` | `.codex/skills/<name>/` |
| `openai-agents` | `.openai-agents/<name>/` |
| `langgraph` | `.langgraph/<name>/` |
| `generic` | `.openagents/<name>/` |

### `openagents search <query>`

```bash
openagents search "code review"
```

Prints a table of matching packages from `GET /api/v1/search?q=`.

### `openagents info <owner/name>`

```bash
openagents info openagents/pr-reviewer
```

Prints the manifest: kind, license, tags, runtimes, pricing, entry file, file
list, declared inputs, and download stats.

### `openagents init`

Scaffolds a new package in the current (or given) directory — no prompts, flag-driven:

```bash
openagents init --kind workflow --name my-workflow --title "My Workflow" \
  --summary "Does the thing." --tags automation,example --runtimes claude-code,generic
```

Writes `openagent.yaml`, `README.md`, and the kind-appropriate entry file
(`WORKFLOW.md` / `HARNESS.md` / `RULES.md` / `SKILL.md`) as templates ready to
fill in. Use `--force` to overwrite existing files.

### `openagents validate [dir]`

```bash
openagents validate ./catalog/openagents/pr-reviewer
```

Hand-written checks (no schema library) against `openagent.yaml` in `dir`
(default: current directory): required keys and types, `owner`/`name` format,
semver `version`, valid `kind`/`runtimes`/`pricing.model`, `entry` present in
`files`, every file in `files` (and `entry`) actually exists on disk, and that
a `README.md` sits alongside the manifest. Exits non-zero on any issue.

### `openagents publish`

Publishing from the CLI is coming soon. For now it prints where to go: sign in
at `<registry>/publish` for the hosted flow, `POST /api/v1/publish`, or open a
PR adding a free package under `catalog/<owner>/<name>/`.

## Configuration

- `OPENAGENTS_REGISTRY` — default registry base URL, overridden per-command by
  `--registry`.

## Development

```bash
cd cli
npm install
node bin/openagents.js --help
node bin/openagents.js init --dir /tmp/scratch-pkg
node bin/openagents.js validate /tmp/scratch-pkg
```
