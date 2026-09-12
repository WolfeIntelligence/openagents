---
title: CLI
description: Every openagents CLI command — add, update, publish, login, search, info, init, validate, list, remove.
order: 5
---

# CLI

`openagents` (0.3.0) is a standalone npm package (zero runtime dependencies besides
`tar`, Node.js 18+) for installing, searching, publishing, and scaffolding OpenAgents
packages from the command line. Every request it makes sends
`User-Agent: openagents-cli/<version>` so the registry can attribute installs.

```bash
npx openagents-cli --help
# or install it globally:
npm install -g openagents-cli
```

An unrecognized global or command flag is an error (`unknown option: --foo`), not a
silent no-op.

## `openagents add <owner/name>`

Downloads a package (and, by default, everything it `requires`) and installs it into
the right directory for your runtime, generating a runtime-specific discovery shim so
the target runtime actually picks it up (not just a directory of files) — see
[Runtimes](/docs/runtimes) for the full per-runtime breakdown.

```bash
openagents add openagents/pr-reviewer
openagents add openagents/pr-reviewer@1.2.0     # exact pinned version
openagents add openagents/pr-reviewer@^1        # highest 1.x version
openagents add openagents/pr-reviewer --runtime claude-code
openagents add openagents/pr-reviewer --dir ./my-project
openagents add openagents/pr-reviewer --no-deps # skip `requires` resolution entirely
```

`owner/name@version` accepts either an exact version or an npm-style semver range
(`^1`, `~1.2`, `>=1.0.0 <2.0.0`, etc.) — resolved against
[`GET /versions`](/docs/api#get-apiv1packagesownernameversions), which lists every
published version. No `@` suffix installs the highest version available (equivalent
to `@*`).

### Dependency resolution

Unless `--no-deps` is passed, `add` reads the manifest's `requires` field (see
[Package Format](/docs/package-format)) and installs every dependency too, walking
transitively — a dependency's own `requires` are followed the same way. Two failure
modes are reported clearly rather than silently picking one side:

- **Cycle** — package A requires B (transitively) requires A again. Reported with the
  full cycle path; nothing is installed.
- **Conflict** — two different packages in the graph require incompatible version
  ranges of the same dependency (e.g. one wants `^1`, another wants `^2`, with no
  version satisfying both). Reported with both requesters and their ranges; nothing is
  installed. There's no "install both side by side" — one version wins, or you fix the
  ranges.

### Integrity

Every downloaded tarball is checked against the `X-Checksum-Sha256` header the
registry sends (see [API Reference](/docs/api#get-apiv1packagesownernameversionsversiondownload))
by hashing the extracted bytes and comparing — a mismatch aborts the install with
nothing left partially written. The checksum is recorded as `integrity` in
`.openagents/installed.json` (see **Lockfile** below) so a later `openagents update`
or `outdated` check can tell a re-download apart from a tampered one.

| Flag | Description |
|---|---|
| `--runtime <id>` | One of `claude-code`, `cursor`, `codex`, `openai-agents`, `langgraph`, `generic`. Auto-detected when omitted — see [Runtimes](/docs/runtimes). |
| `--registry <url>` | Registry base URL. Defaults to `OPENAGENTS_REGISTRY` or `https://openagents-nu.vercel.app`. |
| `--dir <path>` | Project root to install into. Defaults to the current directory. |
| `--no-deps` | Skip `requires` resolution — install only the named package. |
| `--force` | Install despite an open `critical`-severity advisory (see **Advisories** below). |
| `--json` | Print the result as JSON instead of human-readable text. |

Under the hood: `GET /api/v1/packages/{owner}/{name}/versions` to resolve a range to
an exact version, then `GET .../versions/{version}` for that version's manifest, then
`GET .../versions/{version}/download?runtime=<id>` for the tarball, extracted into the
runtime's install directory, followed by writing that runtime's shim (a `SKILL.md`
with frontmatter, a `.cursor/rules/<name>.mdc` file, etc.) After installing, `add`
prints a runtime-specific "next step" hint — e.g. restart Claude Code, or check
`.cursor/rules/` picked it up — and prints a deprecation warning if the package (or
any resolved dependency) has `status: "deprecated"` (see
[Publishing](/docs/publishing#package-lifecycle)).

If the package is paid and you haven't purchased it, `add` fails with the server's
`402` reason surfaced directly (not a raw HTTP error) and prints the package's page URL
so you can buy it in the browser: buying from the CLI itself isn't supported yet. If
you're signed in (`openagents login`) and the package is paid, the download request
carries your token so a purchase you already made is honored.

### Advisories

Before installing, `add` fetches
[`GET .../advisories`](/docs/api#security-advisories) for the package (and every
resolved dependency) and prints any open ones:

```
⚠ moderate advisory on openagents/pr-reviewer: outdated regex allows a crafted
  diff to skip review — fixed in 1.3.1
```

A `critical`-severity advisory **blocks the install** unless `--force` is passed:

```bash
openagents add someone/flagged-package
# ✗ critical advisory: <title> (see <package-url>#advisories) — re-run with --force to install anyway

openagents add someone/flagged-package --force
```

`openagents info <owner/name>` also prints open advisories (without the
install-time block) so you can check before deciding to add something.

| Flag | Description |
|---|---|
| `--force` | Install despite an open `critical` advisory. Has no effect (and prints nothing extra) when there's no critical advisory to override. |

## `openagents outdated`

Compares every entry in `.openagents/installed.json` against the registry's latest
version for that package and prints what's behind.

```bash
openagents outdated
openagents outdated --json
```

```
PACKAGE                       INSTALLED   LATEST   
openagents/pr-reviewer        1.1.0       1.2.0
openagents/agent-guardrails   2.0.0       2.0.0    (up to date, omitted from non-json output)
```

## `openagents update [owner/name]`

Re-resolves and reinstalls, respecting each package's originally-installed version
range (an exact pin stays pinned; a range like `^1` re-resolves to the current highest
match). With no argument, updates every installed package.

```bash
openagents update                        # everything, within each package's existing range
openagents update openagents/pr-reviewer # just this one
openagents update --latest               # ignore the original range; jump to the true latest for everything
```

| Flag | Description |
|---|---|
| `--latest` | Update to the newest published version regardless of the range the package was originally installed with. |
| `--dir <path>` | Project root. Defaults to the current directory. |

## `openagents login [--token <token>]`

Authenticates the CLI by storing a personal access token.

```bash
openagents login                    # prompts for a token (create one at /settings/tokens)
openagents login --token oa_...     # non-interactive, e.g. in CI
```

The token is saved to the config file (see **Configuration** below) and used as
`Authorization: Bearer` on every subsequent request that needs it (`publish`, paid
`add`, `whoami`). It is never sent to any registry other than the one the token was
saved against.

## `openagents logout`

Removes the stored token from the config file. Does not revoke it server-side — do
that from [`/settings/tokens`](/settings/tokens) or `DELETE /api/v1/tokens/{id}` if the
token itself needs to stop working, not just stop being used locally.

## `openagents whoami`

Prints the identity associated with the stored token (or `OPENAGENTS_TOKEN`), via
`GET /api/v1/me` — handle, name, and which scopes the token carries. Exits non-zero
with a clear message if not logged in or the token is invalid/revoked.

```bash
openagents whoami
openagents whoami --json
```

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
package's page URL to buy it. A `pricing.model: subscription` package prints its
price as `$9.00/month` (or `/year`) instead of a flat one-time amount. `--json`
prints the raw package response instead, including `pricing.interval` when present.

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

## Binary files

`openagents publish`/`--dry-run` detects binary files in a package directory by
content (not just extension) and packs them automatically — no manual base64
step. Each binary file is sent as `{ path, content: <base64>, encoding: "base64",
mode }`, where `mode` is `493` (`0o755`) if the file's executable bit is set on
disk, `420` (`0o644`) otherwise. Executable-bit detection reads the real POSIX
mode and only works on POSIX (macOS/Linux); Windows has no equivalent bit to read,
so files packed from Windows always publish as `mode: 420` — set it another way if
a script genuinely needs to be executable after install on POSIX. `openagents add`
extracts a downloaded tarball preserving each file's `mode`, so an executable
script stays executable after install without an extra `chmod`. See
[Package Format](/docs/package-format#binary-files) for the registry's 2 MB
binary-total cap and [API Reference](/docs/api) for the wire format.

## `openagents publish [dir]`

```bash
openagents publish                                  # current directory
openagents publish ./catalog/me/my-package
openagents publish --dry-run                         # validate + show what would be sent, publish nothing
openagents publish --changelog "Fix the flaky retry"
openagents publish --from-github github.com/me/my-package
```

Requires `openagents login` first (or `OPENAGENTS_TOKEN` set) — the stored token needs
the `publish` scope. Runs the same local checks as `openagents validate [dir]`, then
calls `POST /api/v1/publish` (or, with `--from-github <url>`,
`POST /api/v1/publish/import` — see [Publishing](/docs/publishing#publish-from-github))
directly, so there's no separate PR step for a paid package or a database-backed free
one. (Free packages destined for the bundled seed catalog still go through a pull
request against `catalog/<owner>/<name>/` instead — see [Publishing](/docs/publishing)
for when to use which path.)

| Flag | Description |
|---|---|
| `--dry-run` | Validate and print what would be published (files, target version, whether this looks like a new package vs. a new version) without calling the registry. |
| `--changelog <text>` | Changelog for this version, forwarded as-is to the API. |
| `--from-github <url>` | Publish from a public GitHub repo instead of `dir` — see [Publishing](/docs/publishing#publish-from-github) for the accepted URL forms. |

```ts
// printed on success
{ id: "me/my-package", version: "1.0.0", url: "https://.../p/me/my-package", status: "live" | "pending" }
```

`status: "pending"` means the registry has `REQUIRE_REVIEW` on and this was a
brand-new package — see [Publishing](/docs/publishing#review-mode-require_review1).
`--dry-run`'s pre-flight summary shows price as `free`, a flat amount (`$5.00`), or
`$9.00/month`/`/year` for a `pricing.model: subscription` package, and calls out how
many of the packed files are binary (see [Binary files](#binary-files) above) when
any are.

## Lockfile: `.openagents/installed.json`

`add`, `list`, `remove`, `outdated`, and `update` all read/write a lockfile at
`.openagents/installed.json` in the project root (or `--dir`). It's local, plain JSON,
and safe to commit if you want `openagents list` to reflect what's checked in.

**`lockfileVersion: 2`** (this CLI version) adds, per installed package: the version
**range** originally requested (so `update` without `--latest` knows what it's still
allowed to move within), and `integrity` — the `X-Checksum-Sha256` recorded at install
time (see **Integrity** under `add` above). A v1 lockfile (no `lockfileVersion` field,
from CLI < 0.3.0) is read fine — entries just have no range/integrity until they're
next reinstalled or updated, at which point they're upgraded in place.

## Configuration

| Env var | Purpose |
|---|---|
| `OPENAGENTS_REGISTRY` | Default registry base URL for every command; overridden per-invocation by `--registry`. |
| `OPENAGENTS_TOKEN` | Personal access token, used instead of (and overriding) whatever `openagents login` has stored — handy in CI where you don't want to write the config file at all. |

`openagents login` writes the token to a config file at
`~/.config/openagents/config.json` (Linux/macOS) or
`%APPDATA%\openagents\config.json` (Windows) — plain JSON, `{ "token": "oa_..." }`,
scoped per-machine, not committed to a project. `OPENAGENTS_TOKEN` always wins over
this file when both are present.

## Global flags

`-h` / `--help` prints usage. `-v` / `--version` prints the installed CLI version.
`--json`, where supported (`search`, `info`, `add`, `list`, `outdated`, `whoami`),
prints machine-readable output instead of formatted text.
