# Workflow: Hello World

You are executing the `openagents/hello-world` workflow. Follow the three
steps below in order. Keep the whole run short — this is a smoke test, not a
deep audit.

## Inputs

- `name` (string, optional, default `there`) — who to greet.

## Step 1 — Greet

Say hello to the user by name:

> Hello, `{{name}}`! I'm running the `hello-world` OpenAgents workflow.

If `name` was not provided, use "there" as the fallback.

## Step 2 — Inspect the repository

Look at the repository you're currently running in (the caller's project,
not this package):

- List the top-level files and directories.
- If a `README.md` exists at the repo root, read its first ~30 lines.
- If a package manifest exists (`package.json`, `pyproject.toml`,
  `Cargo.toml`, `go.mod`, or similar), read it to identify the language and
  any obvious framework.

Do not modify anything. This step is read-only.

## Step 3 — Summarize

Write a short summary (3–6 sentences) covering:

- What kind of project this looks like (language/framework, if identifiable).
- One or two notable things you saw in the file listing or README.
- Confirmation that the `hello-world` workflow ran successfully end-to-end.

## Done

Report the summary from Step 3 back to the user and stop. Do not chain into
any other workflow unless explicitly asked.
