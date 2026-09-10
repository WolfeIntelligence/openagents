# OpenAgents — Product & Technical Spec (v0.1)

OpenAgents is an open-source marketplace for **agentic workflows, harnesses, and rules**.
Think Hugging Face, but the artifacts are packaged agent behaviors rather than model weights.
Creators publish packages; some are free, some are paid. Users browse, install, and run them in
their own agent runtime (Claude Code, Cursor, Codex CLI, OpenAI Agents SDK, LangGraph, or generic).

## Package kinds

| kind       | what it is                                                                   |
|------------|------------------------------------------------------------------------------|
| `workflow` | A multi-step, goal-directed procedure an agent executes (e.g. "PR review").  |
| `harness`  | Scaffolding around an agent: loop control, tool wiring, eval hooks, guards.  |
| `rules`    | Constraints / style / policy files an agent must obey (e.g. CLAUDE.md sets). |
| `skill`    | A reusable capability with its own instructions + helper scripts.            |

## Package format

A package is a directory containing `openagent.yaml`, a `README.md`, and any number of files.

```yaml
# openagent.yaml
schema: 1
name: pr-reviewer            # [a-z0-9-]{2,64}
owner: openagents            # creator handle
version: 1.2.0               # semver
kind: workflow               # workflow | harness | rules | skill
title: Pull Request Reviewer
summary: One-line description (<= 160 chars)
license: MIT                 # SPDX id, or "proprietary" for paid
tags: [code-review, github, quality]
runtimes: [claude-code, cursor, codex, generic]   # see Runtime list
pricing:
  model: free                # free | one-time (subscription is reserved, not yet accepted)
  amount_cents: 0            # required when not free
  currency: usd              # 3-letter lowercase ISO 4217, must be Stripe-supported
entry: WORKFLOW.md           # main file an agent reads first
files:                       # every shipped file, relative paths
  - WORKFLOW.md
  - rules/review-checklist.md
inputs:                      # optional, declared parameters
  - name: repo
    type: string
    required: true
    description: owner/name of the repository
requires:                    # optional deps on other packages
  - openagents/base-rules@^1
```

Runtime ids: `claude-code`, `cursor`, `codex`, `openai-agents`, `langgraph`, `generic`.

The install target layout per runtime is defined in `src/lib/runtimes.ts` and matches
`src/content/docs/runtimes.md`: `claude-code` → `.claude/skills/<name>/`, `cursor` →
`.cursor/rules/<name>/` (plus a top-level `.cursor/rules/<name>.mdc` shim), `codex` →
`.codex/skills/<name>/`, `openai-agents` → `.openai-agents/<name>/`, `langgraph` →
`.langgraph/<name>/`, `generic` → `.openagents/<name>/`.

## Architecture

- **Next.js 16 App Router, TypeScript, Tailwind 4**, deployed on Vercel.
- **Catalog abstraction** (`src/lib/catalog/index.ts`): `getCatalog()` returns a `Catalog` implementation.
  - `seed` implementation: reads packages from `/catalog/<owner>/<name>/` on disk at build time (free, bundled packages). Always available.
  - `db` implementation: Drizzle ORM + Postgres (Neon / Vercel Postgres). Enabled when `DATABASE_URL` is set. Merges DB packages with seed packages.
- **Auth**: Auth.js v5, GitHub and Google providers, each independently enabled once its own client id/secret plus `AUTH_SECRET` exist; otherwise sign-in UI shows a "not configured" state. Never crash without env.
- **Payments**: Stripe Connect, connected accounts created with **Stripe Accounts v2** (`stripe.v2.core.accounts`, not the legacy v1 Express `stripe.accounts.create`). Platform fee = `PLATFORM_FEE_BPS` (default 1000 = 10%). Enabled only when `STRIPE_SECRET_KEY` exists. Checkout route + webhook route exist and return 503 when disabled. Paid packages are gated file-by-file: only `README.md` and `openagent.yaml` are readable pre-purchase; every other file and the tarball download return 402 for a non-owner who hasn't bought it.
- **Distribution**: packages are downloadable as a tarball (`/api/v1/packages/{owner}/{name}/download`, or pinned to a version via `.../versions/{version}/download`) and installable with the CLI (`npx openagents add owner/name[@version|@range]`), which resolves `requires` transitively and checks tarball integrity against `X-Checksum-Sha256`.
- **Auth tokens**: personal access tokens (`oa_` + 40 hex, `Authorization: Bearer`), scoped `read`/`publish`/`star`/`download`, managed at `/settings/tokens` and `/api/v1/tokens`. A session is equivalent to holding every scope. Publish/star/paid-download routes accept either.
- **Lifecycle & moderation**: a package's `status` is `pending` (only with `REQUIRE_REVIEW=1`, owner/admin-only until approved) → `live` → optionally `unlisted` (hidden from listings, still installable by URL) or `deprecated` (listed with a banner, CLI warns). Owner/admin change status via `/api/v1/packages/{owner}/{name}/status`; anyone can report a package (`.../report`, anonymous allowed); admins (`users.isAdmin` or `ADMIN_HANDLES`) work the queue at `/admin`.
- **Reviews**: one star rating (1–5) + optional text per user per package (`/api/v1/packages/{owner}/{name}/reviews`, GET/PUT upsert/DELETE); owners can't review their own package; `package_stats.ratingAverage`/`ratingCount` are derived from this table.
- **Analytics**: per-package download/star/rating stats (`/api/v1/packages/{owner}/{name}/stats`) backed by `download_events` — one row per (package, salted daily client hash, UTC day), so repeat installs from one machine in a day count once. Feeds the seller `/dashboard`.
- Everything must build and run with **zero env vars** set (seed catalog only). This is the deploy target for v0.1.

## Shared types

All code imports domain types from `src/lib/types.ts` (authoritative, do not redefine).

## Routes

| route                                          | purpose                                                     |
|------------------------------------------------|-------------------------------------------------------------|
| `/`                                            | landing: hero, search, featured packages, how it works       |
| `/explore`                                     | browse; query params `q`, `kind`, `runtime`, `price`, `sort` |
| `/p/[owner]/[name]`                            | package detail: README, manifest, files, versions, install   |
| `/p/[owner]/[name]/files/[...path]`            | raw file viewer                                             |
| `/u/[owner]`                                   | creator profile + their packages                            |
| `/publish`                                     | how to publish; upload form (DB mode) or CLI instructions   |
| `/purchases`                                   | signed-in buyer's purchase history                           |
| `/settings/payouts`                            | signed-in seller's Connect status, revenue, payouts          |
| `/settings/tokens`                             | signed-in user's personal access tokens                      |
| `/settings/profile`                            | signed-in user's editable profile                             |
| `/dashboard`                                   | signed-in seller's analytics (downloads, stars, ratings)      |
| `/admin`                                       | admin-only: pending queue, reports, featured toggles          |
| `/stars`                                       | signed-in user's starred packages                              |
| `/tags`                                        | browse packages by tag                                        |
| `/signin`                                      | GitHub/Google sign-in                                        |
| `/docs`, `/docs/[slug]`                        | docs: spec, publishing, CLI, runtimes, pricing              |
| `/pricing`                                     | platform fee / plans                                        |
| `/api/v1/packages`                             | GET list (filters, `?facets=1`, `sort=trending`), JSON      |
| `/api/v1/packages/[owner]/[name]`              | GET package + manifest + readme + latestVersion/status       |
| `/api/v1/packages/[owner]/[name]/versions`     | GET version history                                          |
| `/api/v1/packages/[owner]/[name]/versions/[version]` | GET package as of one published version                |
| `/api/v1/packages/[owner]/[name]/versions/[version]/download` | GET tar.gz of one version (ETag, X-Checksum-Sha256) |
| `/api/v1/packages/[owner]/[name]/download`     | GET tar.gz of latest version (402 if paid + not purchased)   |
| `/api/v1/packages/[owner]/[name]/files/[...path]` | GET one raw file, `?version=` (402 for non-README/manifest files of an unpurchased paid package) |
| `/api/v1/packages/[owner]/[name]/star`         | GET stars/starred, POST toggle (session or `star`-scoped token; DB required) |
| `/api/v1/packages/[owner]/[name]/status`       | POST change lifecycle status or delete (owner/admin)          |
| `/api/v1/packages/[owner]/[name]/report`       | POST report for moderation (anonymous allowed, rate-limited)  |
| `/api/v1/packages/[owner]/[name]/reviews`      | GET/PUT/DELETE star rating + review (session or token)        |
| `/api/v1/packages/[owner]/[name]/stats`        | GET download/star/rating analytics                            |
| `/api/v1/publish`                              | POST publish a package/version (session or `publish`-scoped token; DB required) |
| `/api/v1/publish/import`                       | POST publish from a public GitHub repo                        |
| `/api/v1/tokens`                               | GET list / POST create a personal access token (session only) |
| `/api/v1/tokens/[id]`                          | DELETE revoke a token (session only)                          |
| `/api/v1/me`                                   | GET the current requester (session or token) + scopes         |
| `/api/v1/users/[handle]`                       | GET public profile + packages                                 |
| `/api/v1/profile`                              | GET/PUT the current user's profile                             |
| `/api/v1/admin/queue`                          | GET pending packages + open reports (admin only)               |
| `/api/v1/admin/packages/[owner]/[name]`        | POST approve/reject/feature (admin only)                       |
| `/api/v1/admin/reports/[id]`                   | POST resolve/dismiss a report (admin only)                     |
| `/api/v1/tags`                                 | GET every tag in use, with counts                              |
| `/api/v1/search?q=`                            | GET search (typo correction via `correctedQuery`)              |
| `/api/v1/openapi`                              | GET the OpenAPI 3.1 document (also served statically at `/openapi.json`) |
| `/api/auth/[...nextauth]`                      | Auth.js (GitHub, Google)                                     |
| `/api/checkout`                                | POST create Stripe Checkout session (503 if disabled)       |
| `/api/connect/onboard`                         | POST create a Stripe Connect onboarding link (auth required) |
| `/api/webhooks/stripe`                         | POST Stripe webhook (503 if disabled)                       |

## Directory layout

```
catalog/<owner>/<name>/openagent.yaml   # seed packages (free, shipped in repo)
cli/                                     # `openagents` CLI package (separate npm package)
src/app/                                 # routes
src/components/                          # UI components
src/lib/types.ts                         # domain types (authoritative)
src/lib/manifest.ts                      # zod schema + parse/validate openagent.yaml
src/lib/runtimes.ts                      # runtime ids, labels, install paths
src/lib/catalog/{index,seed,db}.ts       # catalog abstraction
src/lib/db/{schema,client}.ts            # drizzle
drizzle/                                 # generated SQL migrations + meta journal (npm run db:generate)
src/lib/auth.ts                          # auth.js config (env-gated)
src/lib/stripe.ts                        # stripe client (env-gated)
src/lib/requester.ts                     # session-or-token auth for /api/v1 routes
src/instrumentation.ts                   # Next.js instrumentation hook (onRequestError -> monitoring)
src/lib/monitoring.ts                    # captureError(): stderr always, Sentry when SENTRY_DSN is set
public/openapi.json                      # OpenAPI 3.1 document for every /api/v1 route (+ checkout/webhook/connect)
src/content/docs/*.md                    # docs pages
```

## UI direction

Dark-first, dense, developer-tool aesthetic (think GitHub / Vercel / Hugging Face hub pages).
System font stack, monospace for identifiers, subtle borders, no gradients-for-the-sake-of-it.
Must be responsive. Use plain Tailwind utility classes; no component library.
