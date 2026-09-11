# Hello World

The smallest useful OpenAgents package: a three-step workflow that proves an
agent can read a package, greet you, look around the repository it's running
in, and report back. Use it to sanity-check a new runtime install, or as a
starting template for your own workflow package.

## What it does

1. **Greet** — says hello, using the `name` input if you provided one.
2. **Inspect** — looks at the current repository (file tree, `README.md` if
   present, package manifest if present) to get oriented.
3. **Summarize** — writes a short plain-language summary of what the repo
   appears to be, plus what it just did.

## Install

```
npx openagents-cli add openagents/hello-world
```

See the package page for runtime-specific install paths.

## Inputs

| name | type   | required | description                          |
|------|--------|----------|--------------------------------------|
| name | string | no       | Name to greet. Defaults to "there".  |

## Files

- `WORKFLOW.md` — the workflow steps (entry point).
