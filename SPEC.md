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
  model: free                # free | one-time | subscription
  amount_cents: 0            # required when not free; for subscription, the amount per interval
  currency: usd              # 3-letter lowercase ISO 4217, must be Stripe-supported
  # interval: month           # required when model is subscription: month | year
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
- **Payments**: Stripe Connect, connected accounts created with **Stripe Accounts v2** (`stripe.v2.core.accounts`, not the legacy v1 Express `stripe.accounts.create`). Platform fee = `PLATFORM_FEE_BPS` (default 1000 = 10%), taken on every charge including **subscription renewals** via `application_fee_percent`. Pricing models: `free`, `one-time`, and `subscription` (billed `month` or `year`, `pricing.interval`). Enabled only when `STRIPE_SECRET_KEY` exists. Checkout route, the billing portal (`POST /api/billing/portal`, for a subscriber to update/cancel), and the webhook route exist and return 503 when disabled. A subscription purchase's access lasts until `purchases.expiresAt` (the current billing period end), advanced by `invoice.paid` and ended by `customer.subscription.deleted`. Paid packages are gated file-by-file: only `README.md` and `openagent.yaml` are readable pre-purchase; every other file and the tarball download return 402 for a non-owner/non-subscriber.
- **Distribution**: packages are downloadable as a tarball (`/api/v1/packages/{owner}/{name}/download`, or pinned to a version via `.../versions/{version}/download`) and installable with the CLI (`npx openagents-cli add owner/name[@version|@range]`), which resolves `requires` transitively and checks tarball integrity against `X-Checksum-Sha256`. A package's files may include binary content (`encoding: "base64"`, an optional POSIX `mode`), capped at 2MB total binary content per submission; the tarball preserves each file's mode.
- **Auth tokens**: personal access tokens (`oa_` + 40 hex, `Authorization: Bearer`), scoped `read`/`publish`/`star`/`download`, managed at `/settings/tokens` and `/api/v1/tokens`. A session is equivalent to holding every scope. Publish/star/paid-download routes accept either.
- **Lifecycle & moderation**: a package's `status` is `pending` (only with `REQUIRE_REVIEW=1`, owner/admin-only until approved) → `live` → optionally `unlisted` (hidden from listings, still installable by URL) or `deprecated` (listed with a banner, CLI warns). Owner/admin change status via `/api/v1/packages/{owner}/{name}/status`; anyone can report a package (`.../report`, anonymous allowed); admins (`users.isAdmin` or `ADMIN_HANDLES`) work the queue at `/admin`.
- **Reviews**: one star rating (1–5) + optional text per user per package (`/api/v1/packages/{owner}/{name}/reviews`, GET/PUT upsert/DELETE); owners can't review their own package; `package_stats.ratingAverage`/`ratingCount` are derived from this table.
- **Analytics**: per-package download/star/rating stats (`/api/v1/packages/{owner}/{name}/stats`) backed by `download_events` — one row per (package, salted daily client hash, UTC day), so repeat installs from one machine in a day count once. Feeds the seller `/dashboard`. In DB mode, catalog list/tags/facets responses are cached 60s per instance.
- **Collections**: curated, ordered lists of packages (`collections`/`collection_items` tables), owned by a user, public or unlisted, optionally editorially `featured` by an admin. CRUD under `/api/v1/collections`; pages at `/collections`, `/collections/new`, `/c/{handle}/{slug}`.
- **GitHub auto-sync**: a package can be linked to a repo (`package_sources` table) via `/api/v1/packages/{owner}/{name}/source`; a `release`/tag-push webhook at `/api/webhooks/github/{id}` (verified by a per-source secret, falling back to `SOURCE_WEBHOOK_KEY`/`AUTH_SECRET`) republishes it when the manifest version is greater.
- **Rate limiting**: durable, Postgres-backed (`rate_limits` table) fixed-window counters shared across serverless instances when `DATABASE_URL` is set, falling back to the prior in-memory/per-instance limiter otherwise.
- **Content-Security-Policy**: enforced (not report-only), with a per-request nonce threaded onto every server-rendered `<script>` tag; creator READMEs render via `react-markdown` with raw HTML disabled.
- **Email notifications**: purchase/sale/report/status emails via Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`), routed through `src/lib/notify.ts`; a no-op without the key.
- **Account controls**: `GET /api/v1/account/export` (full JSON export), `DELETE /api/v1/account` (session-only, blocked while owning packages with sales or holding an active subscription).
- **Sharing/SEO**: per-package/creator OG images, `GET /api/v1/packages/{owner}/{name}/badge` (SVG), `SoftwareSourceCode` JSON-LD, `/feed.xml` RSS.
- **Organizations**: a shared publisher identity (`organizations`/`organization_members` tables, `handle` in the same namespace as user handles; `packages.ownerType` says which a given `owner` is). Roles `owner`/`admin`/`member` — `owner`/`admin` can publish/transfer under the org and manage membership, all members get paid-download access to what the org owns, the last `owner` can't leave. CRUD under `/api/v1/orgs`; pages at `/org/{handle}`, `/settings/orgs`. `POST /api/v1/packages/{owner}/{name}/transfer` moves a package to another user or org.
- **Trust & safety**: every publish is scanned (`src/lib/scan.ts`) against a fixed rule set (prompt-injection overrides, hidden/encoded text, credential-reads-plus-network-calls, calls to unknown hosts, destructive commands, leaked secrets, obfuscated eval); the result (`riskScore`/`scanFlags` on `package_versions`) is returned as `PublishResult.scan`. A score ≥ 70 holds a brand-new package as `pending` or unlists a flagged update to an existing package pending admin review (`/admin`, `GET /api/v1/admin/scans?min=`). Admins can also post **security advisories** (`advisories` table, severity `low`\|`moderate`\|`high`\|`critical`) against a package; the CLI blocks installing a `critical` one without `--force`.
- **Version diffs & changelog**: `GET /api/v1/packages/{owner}/{name}/versions/{version}/diff?against=` (per-file status/hunks/summary, `402` for a paid package's non-preview files) backs the compare page `/p/{owner}/{name}/compare?from=&to=&view=split|unified`; a site-wide `/changelog` (+ `?owner=`) and `/changelog.xml` list every published version.
- **Reviews, extended**: `?sort=newest|rating|helpful&limit=&offset=` plus a rating histogram on `GET .../reviews`; writing/deleting a review needs the new `review` token scope (in addition to a session).
- **Refunds**: `refund_requests` table (`open`\|`approved`\|`denied`\|`refunded`), 14-day window, one-time purchases only. `POST /api/v1/refunds`, `GET ?mine=1|seller=1`, seller/admin resolves via `POST /api/v1/refunds/{id}` — approval issues a full Stripe refund (fee and transfer both reversed) and revokes access, same as a `charge.refunded` webhook. `GET /api/v1/admin/refunds` for the platform-wide view; `/refund-policy` page.
- **Seller onboarding**: `POST /api/v1/validate` (unauthenticated, no side effects) runs manifest validation plus a README linter (title, install/usage, example, no TODO placeholders, minimum length, no broken relative links, tags/runtimes/homepage hints) — what the `/publish` wizard's Check step calls before submitting.
- **Ops**: three Vercel Cron routes authorized by `CRON_SECRET` (`POST /api/cron/rollup-downloads` daily, `/api/cron/cleanup` hourly, `/api/cron/review-reminders` daily); `download_rollups` table (daily aggregates per package/runtime/version) feeds `/dashboard` and `sort=trending` without scanning raw events. `429` responses carry `X-RateLimit-Limit`/`X-RateLimit-Remaining`/`X-RateLimit-Reset` alongside `Retry-After`. `GET /api/v1/admin/analytics?days=` backs `/admin/analytics`.
- **Search**: `GET /api/v1/search?suggest=1&limit=6` returns a slim shape for header search-as-you-type; keyboard shortcuts (`/`, `g e`, `g h`, `g t`, `g c`, `?`); a locally-stored "recently viewed" rail on the landing page.
- **End-to-end tests**: a Playwright suite (`npm run test:e2e`, `docs/E2E.md`) runs in CI against a zero-env build.
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
| `/purchases`                                   | signed-in buyer's purchase history, with renewal/end dates and a Manage button for subscriptions |
| `/collections`, `/collections/new`             | browse curated collections; create a new one                 |
| `/c/[handle]/[slug]`                           | one collection: items, notes, "copy install-all" command      |
| `/settings/sources`                            | signed-in seller's linked GitHub package sources               |
| `/settings/account`                            | export or delete the signed-in user's account                 |
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
| `/api/v1/collections`                          | GET list (`featured`, `owner`, `limit`, `offset`), POST create (session or `publish`-scoped token) |
| `/api/v1/collections/[handle]/[slug]`          | GET/PATCH/DELETE one collection + items                       |
| `/api/v1/collections/[handle]/[slug]/items/[owner]/[name]` | PUT add/reorder/annotate, DELETE remove an item        |
| `/api/v1/admin/collections/[handle]/[slug]`    | POST toggle `featured` (admin only)                            |
| `/api/v1/packages/[owner]/[name]/badge`        | GET SVG badge, `?type=version\|downloads\|stars\|rating`      |
| `/api/v1/packages/[owner]/[name]/source`       | PUT/GET/DELETE link/read/unlink a GitHub source                |
| `/api/v1/packages/[owner]/[name]/source/sync`  | POST trigger a sync now                                        |
| `/api/webhooks/github/[id]`                    | POST GitHub release/tag-push receiver for one linked source    |
| `/api/v1/account/export`                       | GET the signed-in user's full data export (JSON download)      |
| `/api/v1/account`                              | DELETE the signed-in user's account (`{confirm: handle}`)       |
| `/p/[owner]/[name]/opengraph-image`, `/u/[owner]/opengraph-image` | GET generated OG image                        |
| `/feed.xml`                                    | GET RSS feed of newly published/updated packages                |
| `/api/auth/[...nextauth]`                      | Auth.js (GitHub, Google)                                     |
| `/api/checkout`                                | POST create Stripe Checkout session, one-time or subscription mode (503 if disabled) |
| `/api/billing/portal`                          | POST create a Stripe billing portal session for a subscriber (session required) |
| `/api/connect/onboard`                         | POST create a Stripe Connect onboarding link (auth required) |
| `/api/webhooks/stripe`                         | POST Stripe webhook, incl. `invoice.paid`/`invoice.payment_failed`/`customer.subscription.updated`/`customer.subscription.deleted` (503 if disabled) |
| `/api/v1/orgs`                                 | GET list (`?member=me` for the caller's own), POST create |
| `/api/v1/orgs/[handle]`                        | GET/PATCH/DELETE one organization + its members |
| `/api/v1/orgs/[handle]/members`                | PUT add/change a member's role |
| `/api/v1/orgs/[handle]/members/[userHandle]`   | DELETE remove a member (or leave) |
| `/api/v1/packages/[owner]/[name]/transfer`     | POST transfer a package to another user/org handle |
| `/api/v1/packages/[owner]/[name]/advisories`   | GET list open advisories, POST create (admin) |
| `/api/v1/packages/[owner]/[name]/advisories/[id]` | PATCH edit/withdraw an advisory (admin) |
| `/api/v1/admin/scans`                          | GET recently-published versions by scan score (`?min=`, admin only) |
| `/api/v1/packages/[owner]/[name]/versions/[version]/diff` | GET per-file diff against another version (`?against=`) |
| `/api/v1/validate`                             | POST manifest + README-lint check, no auth, no side effects |
| `/api/v1/refunds`                              | GET list (`?mine=1`\|`?seller=1`), POST request a refund |
| `/api/v1/refunds/[id]`                         | POST approve/deny (seller or admin) |
| `/api/v1/admin/refunds`                        | GET every refund request (admin only) |
| `/api/v1/admin/analytics`                      | GET platform-wide analytics (`?days=`, admin only) |
| `/api/cron/rollup-downloads`                   | POST daily download rollup (internal, `CRON_SECRET` bearer) |
| `/api/cron/cleanup`                            | POST hourly housekeeping (internal, `CRON_SECRET` bearer) |
| `/api/cron/review-reminders`                   | POST daily review-reminder emails (internal, `CRON_SECRET` bearer) |
| `/org/[handle]`                                | organization profile + its packages |
| `/settings/orgs`                               | signed-in user's organizations and membership |
| `/p/[owner]/[name]/compare`                    | version compare view (`?from=&to=&view=split\|unified`) |
| `/changelog`, `/changelog.xml`                 | site-wide published-versions feed (`?owner=`) |
| `/admin/analytics`                             | admin-only platform analytics dashboard |
| `/refund-policy`                               | buyer-facing refund policy explainer |

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
src/lib/notify.ts                        # fire-and-forget notification hooks called by route handlers
src/lib/email.ts                         # Resend-backed email sending (no-op without RESEND_API_KEY)
src/lib/scan.ts                          # publish-time content scan rules (prompt-injection, secrets, etc.)
public/openapi.json                      # OpenAPI 3.1 document for every /api/v1 route (+ checkout/webhook/connect)
src/content/docs/*.md                    # docs pages
docs/E2E.md                              # what the Playwright e2e suite (npm run test:e2e) covers
```

## UI direction

Dark-first, dense, developer-tool aesthetic (think GitHub / Vercel / Hugging Face hub pages).
System font stack, monospace for identifiers, subtle borders, no gradients-for-the-sake-of-it.
Must be responsive. Use plain Tailwind utility classes; no component library.
