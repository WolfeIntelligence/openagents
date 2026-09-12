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
npm install -g openagents-cli
# or run without installing:
npx openagents-cli --help
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

#### Advisories

Before installing, `add` fetches any open security advisories for the package
(and every resolved dependency) from the registry and prints them:

```
⚠ moderate advisory on openagents/pr-reviewer: outdated regex allows a crafted
  diff to skip review — fixed in 1.3.1
```

A `critical`-severity advisory blocks the install unless `--force` is passed:

```bash
openagents add someone/flagged-package
# ✗ critical advisory: <title> — re-run with --force to install anyway

openagents add someone/flagged-package --force
```

`--force` has no effect (and prints nothing extra) when there's no open critical
advisory to override. `openagents info <owner/name>` also prints open advisories,
without the install-time block, so you can check before deciding to add something.

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

### `openagents login`

```bash
openagents login                          # prints where to get a token, then prompts (echo off)
openagents login --token oa_xxxxxxxxxxxx  # non-interactive
echo "$TOKEN" | openagents login          # piped, e.g. from a secrets manager
```

Tokens are personal access tokens, created on the site at
`<registry>/settings/tokens` — the CLI can't mint one itself (minting is a
session-only endpoint), only accept one you've already created. `login`
verifies the token against `GET /api/v1/me` before storing it, then prints:

```
✓ logged in as @zach (scopes: publish, download)
```

An invalid or revoked token fails cleanly with the server's error message
(no partial/garbage state is written).

### `openagents logout`

```bash
openagents logout
```

Removes the stored token for the target registry (`--registry`). Safe to run
when nothing is stored — prints `not logged in to <registry>` instead of
erroring.

### `openagents whoami`

```bash
openagents whoami
openagents whoami --json
```

Prints the identity, sign-in provider (`via`), and scopes for the token
stored for the current (or `--registry`) registry, by calling
`GET /api/v1/me`. Fails with exit 1 and a hint to run `openagents login` if
nothing is stored, or with the server's message if the stored token was
revoked (401).

### `openagents publish [dir]`

```bash
openagents publish                                    # current directory
openagents publish ./catalog/openagents/pr-reviewer
openagents publish ./my-package --dry-run             # pack + validate, don't upload
openagents publish ./my-package --changelog "Fixed the thing." --json
openagents publish --from-github https://github.com/me/my-package \
  --ref main --subdir packages/my-package
```

Validates the package directory exactly as `openagents validate` does, reads
`openagent.yaml`, `README.md`, and every file `openagent.yaml` lists, enforces
the registry's limits client-side (≤200 files, ≤512KB per file, ≤2MB total text,
≤2MB total binary — see **Binary files** below) so a bad publish fails locally
instead of after an upload, then prints a summary:

```
zach/my-package@1.2.0
  kind:  workflow
  files: 4 (6.1KB total, 1 binary)
  price: $9.00/month
```

`price` reads `free`, a flat amount (`$5.00`), or `$9.00/month`/`$90.00/year` for a
`pricing.model: subscription` package (see **Subscriptions** below) — the CLI reads
`pricing.interval` straight from `openagent.yaml`. The `files` line only mentions a
binary count when the package actually ships one.

### Binary files

A package can include binary files (images, small compiled assets, an icon) as well
as text. `openagents validate`/`publish` detect them by content, not extension, and
handle them differently from text files:

- Each binary file is packed as `{ path, content: <base64>, encoding: "base64",
  mode }` instead of raw UTF-8 text.
- `mode` is `493` (`0o755`) when the file's executable bit is set on disk, `420`
  (`0o644`) otherwise — read via `fs.statSync(...).mode` on POSIX (macOS/Linux).
  Windows has no equivalent bit to expose, so a file packed from Windows always
  gets `mode: 420`; if it genuinely needs to run as a script after install on
  POSIX, set the bit some other way before publishing from a POSIX machine, or
  publish from one directly.
- The registry caps binary files at **2MB total** across a submission, tracked
  separately from (and in addition to) the existing 2MB total-text cap — a
  package can use its full text budget and its full binary budget at once.
- `openagents add` extracts a downloaded tarball preserving each file's `mode`, so
  an executable script stays executable immediately after install, with no manual
  `chmod` step.

See [`src/content/docs/package-format.md`](../src/content/docs/package-format.md#binary-files)
for the registry-side rules in full.

### Subscriptions

`pricing.model: subscription` is a normal manifest value alongside `free` and
`one-time`, paired with a required `pricing.interval: month | year`:

```yaml
pricing:
  model: subscription
  amount_cents: 900
  currency: usd
  interval: month
```

`openagents validate` checks that `interval` is present and is `month` or `year`
whenever `model` is `subscription` (same rule the registry enforces server-side).
`openagents info` prints a subscription's price as `$9.00/month` instead of a flat
amount. Buying a subscription still isn't supported from the CLI itself (see the
paid-package note under `add` above) — the CLI's role is packing and validating the
manifest, not driving Stripe Checkout.

`--dry-run` stops here without making a request. Otherwise it `POST`s to
`/api/v1/publish` with your stored token (run `openagents login` first — a
missing token fails immediately, before packing even completes network-side
work) and prints the resulting package URL and status, calling out
`status: pending (awaiting review)` when the registry queues it for review
instead of publishing immediately.

If `CHANGELOG.md` exists alongside `openagent.yaml`, its first `#`/`##`
section is sent as the changelog automatically; `--changelog <text>`
overrides that. A `400` response renders every issue the registry reports; a
`409` (version already exists) suggests bumping `version` in
`openagent.yaml`.

`--from-github <url>` publishes directly from a GitHub repo instead of a
local directory (`POST /api/v1/publish/import`), with `--ref <branch-or-tag>`
and `--subdir <path>` for a non-default branch or a package that lives in a
subdirectory of the repo.

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
- `OPENAGENTS_TOKEN` — auth token to use for every request, overriding
  whatever `login` has stored on disk (for CI/scripting; never written to a
  file by the CLI itself).
- `OPENAGENTS_CONFIG_DIR` — where `login`/`logout` read and write the token
  file, overriding the OS default.

Every request sends `User-Agent: openagents-cli/<version> (<runtime>)`, and
`add`'s download request appends `?runtime=<id>`, so the registry can
attribute installs by CLI version and runtime.

### Authentication

`openagents login` stores a personal access token per registry in a config
file:

| OS | Path |
|---|---|
| macOS / Linux | `~/.config/openagents/config.json` |
| Windows | `%APPDATA%\openagents\config.json` |

```json
{ "registries": { "https://openagents-nu.vercel.app": { "token": "oa_...", "handle": "zach", "savedAt": "..." } } }
```

The file is written with mode `0600` where the filesystem supports it (POSIX;
not enforced on Windows). Tokens are plaintext `oa_` + 40 hex characters, sent
as `Authorization: Bearer <token>` on every request to the registry they were
saved for; a token carries scopes (e.g. `publish`, `download`) that `whoami`
prints and that gate what it can do server-side. Nothing but `login`/`logout`
touches this file — every other command reads a token via `authHeaders()`
(`cli/lib/util.js`) and never logs or prints it.

Paid packages accept the same bearer token for downloads (a token with the
`download` scope) — once you're logged in, buying a package on the site and
then running `openagents add` should no longer require a browser. (As of this
writing, `add`'s download request doesn't yet attach `authHeaders()` — see
the CLI's `commands/add.js`, owned by a different workstream.)

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
