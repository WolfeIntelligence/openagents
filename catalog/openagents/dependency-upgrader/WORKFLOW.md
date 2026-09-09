# Dependency Upgrader — Workflow

Audits outdated dependencies, upgrades them in ascending risk order, runs the test
suite after each upgrade, and opens one PR per major (potentially breaking) version
bump — so a reviewer can accept or reject each risky upgrade independently, while
patch/minor bumps land together in a single low-risk PR.

Inputs: `package_manager` (auto-detected if omitted), `include_major` (default
`true`), `max_prs` (default `5`).

## Step 1 — Detect the package manager and list outdated deps

Detect from lockfile/manifest presence if not given explicitly: `package-lock.json` →
npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm, `poetry.lock` → poetry,
`requirements.txt` → pip, `Cargo.lock` → cargo, `go.sum` → go modules.

Run the manager's outdated-listing command and capture, per dependency: current
version, latest version, and version type of the jump (patch/minor/major per semver).

| manager | outdated command |
|---|---|
| npm | `npm outdated --json` |
| yarn | `yarn outdated --json` |
| pnpm | `pnpm outdated --format json` |
| pip/poetry | `poetry show --outdated` (or `pip list --outdated`) |
| cargo | `cargo outdated --format json` (requires `cargo-outdated`) |
| go | `go list -u -m -json all` |

## Step 2 — Check for known vulnerabilities

Run the manager's audit command (`npm audit --json`, `pip-audit`, `cargo audit`, etc.)
if available. Any dependency with a known vulnerability gets upgraded regardless of
`include_major`/risk ordering — security fixes jump the queue and get their own PR
labeled accordingly, even if it's a major bump.

## Step 3 — Order by risk

1. **Patch bumps** (x.y.Z) — lowest risk, bundle all of these into a single PR.
2. **Minor bumps** (x.Y.z) — should be backward compatible per semver; bundle into a
   second PR, but read each package's release notes for the range being skipped and
   flag anything that mentions deprecations.
3. **Major bumps** (X.y.z) — one PR **per package**, since these can be breaking and
   need independent review/rollback. Skip this tier entirely if `include_major` is
   `false`.
4. **Security fixes** (from Step 2) — their own PR(s), opened first regardless of
   where they'd otherwise sort, clearly labeled as a security fix with the
   CVE/advisory reference.

Stop opening new PRs once `max_prs` is reached; report which upgrades were deferred
and why (not silently dropped).

## Step 4 — For each PR: upgrade, test, document

1. Create a branch: `build/upgrade-<package>-<new-version>` (or
   `build/upgrade-deps-patch` for the bundled patch/minor PRs), per
   `openagents/commit-conventions` naming if that package is present.
2. Apply the version bump via the package manager (not by hand-editing the lockfile).
3. Run the full test suite. If it fails:
   - First, check whether the failure is caused by the upgrade itself (read the
     failure, check the new package's changelog for a matching breaking change) vs.
     unrelated/flaky.
   - If caused by the upgrade and a straightforward fix is evident (e.g. a renamed
     import, an updated config key documented in the changelog), apply it and re-run.
   - If the fix isn't straightforward, do not force it — stop this specific upgrade,
     note the failure and likely cause in the PR/report, and move to the next
     dependency rather than shipping a red PR.
4. For major bumps: read the package's changelog/migration guide for the skipped
   version range and summarize relevant breaking changes in the PR description, even
   if tests pass — tests may not cover every affected code path.
5. Commit using the project's commit conventions if defined; otherwise
   `build(deps): bump <package> from <old> to <new>`.
6. Open the PR with a description covering: what changed, why (patch/minor/major/
   security), test result, and — for majors — the changelog summary and any manual
   verification still recommended before merge.

## Step 5 — Report

At the end of the run, summarize: PRs opened (with links), upgrades deferred (and
why — test failure, hit `max_prs`, needs `include_major`), and any dependency with a
known vulnerability that could *not* be upgraded (e.g. because a fix isn't released
yet) — flag these clearly since they need a different mitigation.

## Stop conditions

- No outdated dependencies found → report this and stop; don't open empty PRs.
- Package manager can't be detected and wasn't given explicitly → ask rather than
  guessing, since running the wrong manager's commands can corrupt the lockfile.
- A major upgrade's test failures point to a large, cascading breaking change (e.g. a
  framework's rewritten API) that would require substantial rework → stop that
  specific upgrade, document the scope of what changed, and let a human decide whether
  to invest in it, rather than attempting a large rewrite unprompted.
