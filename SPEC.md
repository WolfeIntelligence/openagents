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
- **Distribution**: packages are downloadable as a tarball (`/api/v1/packages/{owner}/{name}/download`) and installable with the CLI (`npx openagents add owner/name`).
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
| `/signin`                                      | GitHub/Google sign-in                                        |
| `/docs`, `/docs/[slug]`                        | docs: spec, publishing, CLI, runtimes, pricing              |
| `/pricing`                                     | platform fee / plans                                        |
| `/api/v1/packages`                             | GET list (same filters as explore), JSON                    |
| `/api/v1/packages/[owner]/[name]`              | GET package + manifest + readme                             |
| `/api/v1/packages/[owner]/[name]/download`     | GET tar.gz of package files (402 if paid + not purchased)   |
| `/api/v1/packages/[owner]/[name]/files/[...path]` | GET one raw file (402 for non-README/manifest files of an unpurchased paid package) |
| `/api/v1/packages/[owner]/[name]/star`         | GET stars/starred, POST toggle (auth + DB required)          |
| `/api/v1/publish`                              | POST publish a package (auth required; DB required)          |
| `/api/v1/search?q=`                            | GET search                                                   |
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
src/lib/auth.ts                          # auth.js config (env-gated)
src/lib/stripe.ts                        # stripe client (env-gated)
src/content/docs/*.md                    # docs pages
```

## UI direction

Dark-first, dense, developer-tool aesthetic (think GitHub / Vercel / Hugging Face hub pages).
System font stack, monospace for identifiers, subtle borders, no gradients-for-the-sake-of-it.
Must be responsive. Use plain Tailwind utility classes; no component library.
