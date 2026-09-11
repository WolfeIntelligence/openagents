# Dependency Upgrader

Audits outdated dependencies across npm/yarn/pnpm/pip/poetry/cargo/go, checks for known
vulnerabilities, and upgrades in ascending risk order: patch and minor bumps bundled
into low-risk PRs, each major (potentially breaking) bump in its own PR with a
changelog summary, and security fixes jumped to the front of the queue regardless of
version-bump size. Runs the test suite after every upgrade.

## When to use

- Periodic dependency maintenance instead of letting `outdated` counts pile up.
- After a security advisory, to get an upgrade PR open fast with the CVE context
  already summarized.
- Before a major framework/runtime migration, to clear out easy patch/minor debt first.

## Install

```bash
npx openagents-cli add openagents/dependency-upgrader
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/dependency-upgrader/` |
| `codex` | `.codex/skills/dependency-upgrader/` |
| `generic` | `.openagents/dependency-upgrader/` |

## Inputs

| name | type | required | default | description |
|---|---|---|---|---|
| `package_manager` | string | no | auto | `npm`\|`yarn`\|`pnpm`\|`pip`\|`poetry`\|`cargo`\|`go`; auto-detected from lockfiles |
| `include_major` | boolean | no | `true` | Include major/breaking-possible bumps, each as its own PR |
| `max_prs` | number | no | `5` | Cap on PRs opened in one run |

## Example run

```
> Run the dependency upgrader, cap it at 3 PRs this time.
```

The agent lists outdated deps, runs an audit for known CVEs, bundles patch/minor
upgrades into one PR, opens a separate PR per major bump (with changelog/migration
notes), runs tests after each, and stops once 3 PRs are open — reporting what was
deferred.

## Files

- `WORKFLOW.md` — the step-by-step procedure (entry point).

## Limitations

- Requires the relevant package manager and (for vulnerability scanning) its audit
  tooling to be installed and runnable in this environment.
- Opening PRs is a side-effectful action — review the generated branches before
  merging, especially major bumps; the workflow documents breaking changes it can
  find, but doesn't guarantee full behavioral compatibility.
- Cargo auditing requires `cargo-outdated`/`cargo-audit` to be installed separately;
  the workflow will note if they're missing rather than silently skipping the check.
