# Repo Onboarding — Workflow

Turns an unfamiliar codebase into a working mental model, written down as
`ONBOARDING.md` in the repo root. The goal is a document that lets the next person (or
the next agent session) become productive without re-doing this exploration.

Inputs: `root_dir` (default `.`), `depth` (`quick` | `standard` | `deep`, default
`standard`).

## Step 1 — Orient at the surface

1. Read root-level files first, in this order: `README.md`, `package.json` /
   `pyproject.toml` / `Cargo.toml` / `go.mod` (whichever exists), `CONTRIBUTING.md`,
   any `AGENTS.md` / `CLAUDE.md`, CI config (`.github/workflows/*.yml`, `.gitlab-ci.yml`).
2. From these, extract: language(s) and version, package manager, framework(s), and the
   scripts/commands already defined for build/test/lint/dev (don't guess these — quote
   them from `package.json` `scripts`, `Makefile` targets, etc.).
3. Run `git log --oneline -20` and skim recent commits — this tells you what part of
   the codebase is actively changing and often surfaces naming conventions in commit
   messages.

## Step 2 — Map the directory structure

1. List top-level directories (`ls`, or a depth-limited tree). For each one, form a
   one-line hypothesis of its purpose from its name and a peek at 2-3 files inside.
2. Identify the "core" directories vs. generated/vendored ones (`node_modules`,
   `dist`, `build`, `.next`, `target`, `vendor`) — exclude the latter from further
   exploration.
3. For `quick` depth, stop here after Step 3. For `standard`/`deep`, continue.

## Step 3 — Find the entrypoints

Entrypoints are where execution starts or where an external actor (HTTP client, CLI
user, message queue) first touches the code. Find them by:
- Checking the `main`/`bin` fields in the package manifest.
- Searching for `if __name__ == "__main__"`, `func main()`, `app.listen(`,
  `createServer(`, route/handler registration, or a CLI framework's entry command.
- For web apps: the routing layer (file-based routes, or a router config file) — list
  the actual routes/endpoints, not just "there's a router."
- For libraries: the public API surface — what's exported from the package root
  (`index.ts`/`__init__.py`/etc.).

Record each entrypoint with its file path and a one-line description of what triggers it.

## Step 4 — Extract conventions

Look for patterns that a new contributor needs to match, not invent:
- Naming conventions (files, functions, components) — infer from 5-10 examples, don't
  assume from one.
- Where tests live relative to source, and what test framework/assertion style is used.
- Error handling pattern (exceptions vs. result types vs. error codes) — check 2-3
  different modules to confirm it's consistent, not a one-off.
- State management / data flow pattern, if applicable (e.g. a specific store pattern,
  a particular ORM usage pattern).
- Linting/formatting config (`.eslintrc`, `pyproject.toml` `[tool.ruff]`, etc.) — quote
  any non-default rules that would surprise a newcomer.
- Any explicit rules already written down (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`)
  — summarize, don't just point at them, so `ONBOARDING.md` is self-contained.

## Step 5 — Determine how to run and test it

Do not guess these — verify by running them (or, if execution isn't available/safe in
this context, quote the exact commands from CI config, since CI is a working
ground-truth of "how this project builds/tests").
- Install: exact command (`npm ci`, `poetry install`, etc.) and any prerequisite
  (Node version, a `.env` file, a running database/service).
- Run locally: exact command and what port/URL it serves, if applicable.
- Run tests: exact command, and whether there are sub-suites (unit vs. integration vs.
  e2e) that run differently.
- Lint/typecheck: exact command(s).
- Anything that commonly trips people up (a required local service, a seed-data step,
  a specific Node/Python version pinned in `.nvmrc`/`.python-version`).

`deep` depth only: actually attempt the install + test commands and note the real
result (pass/fail, time taken, anything that needed a workaround).

## Step 6 — Write ONBOARDING.md

Structure:

```markdown
# Onboarding: <repo name>

## What this is
<2-4 sentences: what the project does, who it's for>

## Architecture
<the mental model: major components/services and how they relate.
 A short list or simple diagram-in-prose is fine — this is not a full design doc.>

## Entrypoints
- `path/to/entry` — <what triggers it>
...

## Directory guide
- `src/foo/` — <purpose>
...

## Conventions
- <naming, testing, error handling, etc. — the things a new contributor must match>

## Running it
- Install: `<command>`
- Dev/run: `<command>`
- Test: `<command>`
- Lint/typecheck: `<command>`
- Gotchas: <anything non-obvious>

## Open questions
<anything you couldn't determine confidently from the code alone —
 flag these rather than guessing, so a human can fill them in>
```

Write this file to `<root_dir>/ONBOARDING.md`. If one already exists, do not silently
overwrite it — show a diff/summary of what changed and let the user confirm, since it
may contain hand-maintained context this pass can't infer.

## Stop conditions

- Repo has no discoverable package manifest or build config → say so and produce a
  best-effort structural summary rather than fabricating run instructions.
- Monorepo with multiple independently-runnable projects → produce one top-level
  overview plus a short per-package pointer rather than merging them into one
  undifferentiated document.
- Explored surface area is large enough that `deep` would take a very long time →
  fall back to `standard` and say so explicitly rather than silently truncating.
