# Contributing

## Adding a free package

The most common contribution is a new free package in the bundled seed catalog. These
ship in the repo and are available on every deployment, with no sign-in and no
database required.

1. **Fork** the repository and create a branch.
2. **Create a directory**: `catalog/<your-handle>/<package-name>/`. Use your own
   handle as the owner — the `catalog/openagents/` namespace is reserved for packages
   maintained by the core project.
3. **Add `openagent.yaml`** — see [`src/content/docs/package-format.md`](./src/content/docs/package-format.md)
   for the full field reference. Requirements for a free package specifically:
   - `pricing.model: free`, `pricing.amount_cents: 0`.
   - `license` must be a permissive SPDX id (e.g. `MIT`, `Apache-2.0`) — the free
     catalog doesn't accept `proprietary`.
   - `owner` matches the directory name under `catalog/`.
   - `entry` is listed in `files`, and every path in `files` exists in the directory.
4. **Add `README.md`** covering: what the package does, when to use it (and, ideally,
   when *not* to), how to install it per runtime, its declared inputs, an example
   invocation, and known limitations. Look at `catalog/openagents/pr-reviewer/README.md`
   for the shape reviewers expect.
5. **Add the entry file and any supporting files** referenced in `files`.
6. **Validate locally** before opening a PR:
   ```bash
   cd cli && npm install   # first time only
   node bin/openagents.js validate ../catalog/<your-handle>/<package-name>
   ```
7. **Open a pull request.** Describe what the package does and why it's useful in the
   PR description.

Once the package is committed, a maintainer runs `npm run sync:meta` to record its real
created/updated dates from git history into `.meta.json`. That file holds only those
dates and the editorial `featured` flag — never download or star counts, which are real
counters in the database and only ever move because someone downloaded or starred the
package.

`npm run check:catalog` (also run in CI) enforces that this actually happens: it fails
with a non-zero exit if any `catalog/<owner>/<name>/` directory is missing `.meta.json`,
or if `.meta.json` exists but `createdAt`/`updatedAt` aren't parsable dates. If you add a
package and forget to run `sync:meta`, this is what will catch it before merge.

## Quality bar

A package gets rejected (or sent back for changes) if it's:

- **Filler.** Vague, generic advice ("write good code," "be careful with security")
  instead of a specific, followable procedure with concrete steps, checklists, or
  templates. Look at the existing `catalog/openagents/*` packages for the expected
  depth — each entry file is 80–200 lines of substantive, step-by-step content, not
  a one-paragraph summary.
- **Untested against its own manifest.** `entry` not in `files`, a file listed that
  doesn't exist, a `summary` over 160 characters, an invalid `kind`/`runtime`/`license`
  value — anything `openagents validate` catches.
- **Duplicative** of an existing package with no meaningful difference — either extend
  the existing one via a PR, or make sure your README explains what's genuinely
  different about yours.
- **Unsafe by default.** A workflow/harness that performs destructive or externally
  visible actions (deleting data, force-pushing, sending messages, spending money)
  without an explicit confirmation step is not acceptable — see
  `catalog/openagents/agent-guardrails` for the pattern to follow.
- **Missing runtime coverage.** `runtimes` should list every runtime the package
  actually works in, and at minimum should include `generic` — a package that only
  works in one specific runtime should say so clearly in its README rather than
  listing runtimes it hasn't been checked against.
- **Carrying secrets or credentials** — never commit real API keys, tokens, or
  connection strings, including in examples. Use obvious placeholders.

## Paid packages

Paid packages (`pricing.model: one-time` — `subscription` is reserved and not yet
accepted) aren't added via PR to `catalog/` — they go through the hosted publish flow
(sign-in + Stripe Connect) so payouts and the platform fee can be handled. See
[`src/content/docs/publishing.md`](./src/content/docs/publishing.md) for the full path
and content policy.

## Code contributions

For changes to the site itself (`src/app`, `src/lib`, `src/components`), open an issue
first for anything non-trivial so the approach can be discussed before you invest time
in it. Small, well-scoped PRs (a bug fix, a docs correction, a CLI improvement) are
welcome without prior discussion.

- Read [`SPEC.md`](./SPEC.md) first — it's the source of truth for routes, the
  manifest schema, and directory layout.
- `src/lib/types.ts` is authoritative for domain types; don't redefine types that
  already live there.
- The app must always build and run with zero environment variables set (seed catalog
  only) — don't add a code path that crashes when `DATABASE_URL`/auth/Stripe env vars
  are absent.

## Reporting issues

Use GitHub Issues for bugs and feature requests. For a bad or misleading package in
the catalog, flag it in an issue with the package's `owner/name` and what's wrong —
maintainers can pull a package from the catalog independently of a code change.
