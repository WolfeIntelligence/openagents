# openagents

The command-line client for [OpenAgents](https://openagents-nu.vercel.app), an
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

Downloads a package from the registry, installs it into the right directory
for your project's runtime, generates that runtime's discovery shim so the
package is actually picked up (see "Runtime discovery" below), and records
the install in `.openagents/installed.json`.

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
  `https://openagents-nu.vercel.app`.
- `--dir <path>` — project root to install into. Defaults to the current
  directory.

`owner/name@version` is accepted, but the registry does not yet support
downloading a specific version — `add` prints the latest version and exits
non-zero rather than silently installing the wrong thing.

Re-running `add` for a package that's already installed updates it in place
(`updating owner/name 1.2.0 → 1.3.0`, or `already at 1.2.0, reinstalling`)
instead of silently overwriting it without saying so.

Install directory per runtime:

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/<name>/` |
| `cursor` | `.cursor/rules/<name>/` |
| `codex` | `.codex/skills/<name>/` |
| `openai-agents` | `.openai-agents/<name>/` |
| `langgraph` | `.langgraph/<name>/` |
| `generic` | `.openagents/<name>/` |

#### Runtime discovery (shims)

Copying package files into an install directory isn't enough for most
runtimes to actually find the package — Claude Code and Codex only discover
skills via a top-level `SKILL.md` with YAML frontmatter, and Cursor only
discovers rules via a top-level `.cursor/rules/*.mdc` file. `add` generates
those automatically:

- **`claude-code` / `codex`** — if the package's `entry` is already
  `SKILL.md` with frontmatter, it's left untouched; if `SKILL.md` exists
  without frontmatter, frontmatter (`name`, `description`) is prepended; for
  any other entry (`WORKFLOW.md`, `HARNESS.md`, `RULES.md`, ...), a new
  `SKILL.md` is generated pointing at `entry` and listing the supporting
  files.
- **`cursor`** — a sibling `.cursor/rules/<name>.mdc` is generated with
  `description`, `globs: []`, and `alwaysApply: true` for `kind: rules`
  packages (`false` otherwise), telling Cursor to follow
  `@.cursor/rules/<name>/<entry>`.
- **`generic` / `openai-agents` / `langgraph`** — no shim; these runtimes
  don't have an auto-discovery convention, so point your own bootstrap at
  `<install-dir>/<entry>` (the CLI prints this as a "next step" hint after
  install).

A generated shim is never silently overwritten once you've edited it: if the
shim that would be written differs from what's already on disk, `add` leaves
it alone and prints a note.

### `openagents list`

```bash
openagents list
openagents list --json
```

Prints the packages recorded in `.openagents/installed.json` for the current
(or `--dir`) project: version, kind, runtime, install path, and when it was
installed.

### `openagents remove <owner/name>`

```bash
openagents remove openagents/pr-reviewer
```

Deletes the recorded install directory (refusing if the recorded path isn't
safely inside the project directory), removes the Cursor `.mdc` shim if one
was generated, and updates `.openagents/installed.json`.

Flags: `--dir <path>`, `--runtime <id>` (override the runtime used to look up
the Cursor shim path, if it wasn't recorded).

### `openagents search <query>`

```bash
openagents search "code review"
openagents search "code review" --json
```

Prints a table of matching packages from `GET /api/v1/search?q=`. `--json`
prints the raw API response. When the API reports a `total` larger than the
number of items returned, the summary line reads `showing N of TOTAL`.

### `openagents info <owner/name>`

```bash
openagents info openagents/pr-reviewer
openagents info openagents/pr-reviewer --json
```

Prints the manifest: kind, license, tags, runtimes, pricing, entry file, file
list, declared inputs, and download stats. `--json` prints the raw API
response. `owner/name@version` is accepted for symmetry with `add`, but only
to print a note that version pinning isn't supported yet — it always shows
the latest version.

### `openagents init`

Scaffolds a new package in the current (or given) directory — no prompts, flag-driven:

```bash
openagents init --kind workflow --name my-workflow --title "My Workflow" \
  --summary "Does the thing." --tags automation,example --runtimes claude-code,generic
```

Writes `openagent.yaml`, `README.md`, and the kind-appropriate entry file
(`WORKFLOW.md` / `HARNESS.md` / `RULES.md` / `SKILL.md`) as templates ready to
fill in. Use `--force` to overwrite existing files, `--version <semver>` to
set the manifest version (defaults to `1.0.0`).

### `openagents validate [dir]`

```bash
openagents validate ./catalog/openagents/pr-reviewer
```

Hand-written checks (no schema library) against `openagent.yaml` in `dir`
(default: current directory): required keys and types, `owner`/`name` format,
semver `version`, valid `kind`/`runtimes`/`pricing.model`, `entry` present in
`files`, every file in `files` (and `entry`) actually exists on disk, and that
a `README.md` sits alongside the manifest. Exits non-zero on any issue.

The YAML parser (`cli/lib/yaml.js`) supports the OpenAgents manifest subset:
block mappings/sequences, quoted and unquoted scalars, inline arrays, and
literal/folded block scalars (`|`, `|-`, `|+`, `>`, `>-`, `>+`). It rejects
tab indentation and an unquoted value containing `: ` (which real YAML reads
as a nested mapping) with a clear error instead of silently mangling them —
`cli/test/yaml.test.js` checks it agrees with the real `yaml` package on
every seed manifest plus a battery of edge cases.

### `openagents publish`

Publishing from the CLI is coming soon. For now it prints where to go: sign in
at `<registry>/publish` for the hosted flow, `POST /api/v1/publish`, or open a
PR adding a free package under `catalog/<owner>/<name>/`.

## Errors

Every command exits non-zero on failure. Registry errors are parsed from the
server's JSON body (`{"error": "...", "issues": [...]}`) instead of dumping
raw HTML/text; a 402 on `add` prints the package's price and a link to buy it
instead of a bare `HTTP 402`. An unrecognized flag fails fast with a
suggestion (`unknown option --runtim (did you mean --runtime?)`) rather than
being silently ignored.

## Configuration

- `OPENAGENTS_REGISTRY` — default registry base URL, overridden per-command by
  `--registry`.

Every request sends `User-Agent: openagents-cli/<version> (<runtime>)`, and
`add`'s download request appends `?runtime=<id>`, so the registry can
attribute installs by CLI version and runtime.

## Development

```bash
cd cli
npm install
node bin/openagents.js --help
node bin/openagents.js init --dir /tmp/scratch-pkg
node bin/openagents.js validate /tmp/scratch-pkg
npm test
```

## Releasing

Tag-triggered: bump `version` in `cli/package.json`, commit, then push a tag
matching `cli-v*` (e.g. `cli-v0.2.0`). `.github/workflows/publish-cli.yml`
runs `npm ci`, `npm test`, and `npm publish --provenance --access public`
against that tag, authenticated with the `NPM_TOKEN` repo secret.
