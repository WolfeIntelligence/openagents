---
title: Self-Hosting
description: Deploy your own OpenAgents instance on Vercel — from zero-config seed catalog to a full DB-backed marketplace with auth and payments.
order: 8
---

# Self-Hosting

OpenAgents is designed to run with **zero environment variables set** — you get the
full site, the seed catalog (all bundled free packages), and a working CLI/API,
with the database-backed catalog, sign-in, and payments simply disabled until you
configure them. Nothing crashes for missing env vars; features degrade to an
explanatory "not configured" state instead.

## One-click deploy (Vercel)

1. Fork the repository.
2. From the Vercel dashboard: **New Project** → import your fork.
3. Deploy with no environment variables set to confirm the zero-config baseline works
   (seed catalog only, no sign-in, no payments) — this should build and serve
   `/`, `/explore`, and every `/p/openagents/<name>` package page.
4. Add environment variables incrementally (below) as you want more features enabled,
   redeploying after each change.

## Environment variables

Copy `.env.example` to `.env.local` for local development, or set these in the Vercel
project's Environment Variables settings for a deployment. Every section is optional
and independent — enable only what you need.

```bash
cp .env.example .env.local
```

### Database (Neon Postgres) — enables the DB-backed catalog, publishing, purchases, stars

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string. Provision via the **Vercel Marketplace → Neon integration** (one click, sets this automatically) or directly at [neon.tech](https://neon.tech). |

When set, the catalog abstraction (`src/lib/catalog/index.ts`) merges DB-backed
packages with the bundled seed catalog; when unset, only the seed catalog is served.
In DB mode, the list/tags/facets responses (`GET /api/v1/packages`,
`GET /api/v1/tags`, and the `?facets=1` breakdown) are cached in memory for 60
seconds per serverless instance — a burst of identical requests hitting the same
warm instance shares one query instead of re-hitting Postgres each time; a fresh
publish/star/report can take up to that long to show up in a listing on an instance
that already has a cached copy.

#### Schema migrations

The schema (`src/lib/db/schema.ts`) is versioned as Drizzle SQL migrations checked
into `drizzle/` — commit that directory, don't `.gitignore` it away in a fork.

| Command | When |
|---|---|
| `npm run db:generate` | After every schema edit. Diffs `src/lib/db/schema.ts` against the last migration snapshot and writes a new file under `drizzle/` (or nothing, if there's no drift). Runs entirely offline — no `DATABASE_URL` needed. |
| `npm run db:migrate` | The recommended path now. Applies any not-yet-applied migrations in `drizzle/` to `DATABASE_URL` — see **Baselining** below for what it does the first time it runs against a database that was set up with `db:push`. |
| `npm run db:push` | Pushes the current schema straight to `DATABASE_URL`, skipping the migrations folder entirely. Still works, but `db:migrate` is now the recommended path — see below. |
| `npm run db:studio` | Opens Drizzle Studio against `DATABASE_URL` to browse data. |

**`db:migrate` is now the recommended way to apply schema changes**, including on
the hosted deployment — run it as a release step (a Vercel deploy hook, or by hand)
after pulling schema changes, instead of `db:push`.

#### Baselining a `db:push`-created database

Every database that predates this change was set up with `db:push`, which doesn't
record anything in Drizzle's migrations-applied table — so the very first time
`db:migrate` runs against one of those databases, it **baselines** it automatically:
it detects that the schema already matches (or is a subset of) an existing
migration and marks that migration (and everything before it) as already applied,
without re-running any SQL against tables that already exist. From that point on,
`db:migrate` behaves normally — only genuinely new migrations run. A brand-new,
empty database has nothing to baseline; `db:migrate` just applies every migration
from `drizzle/0000_*.sql` forward, including `drizzle/0001_*` (the batch-3 delta:
new tables for durable rate limits, collections, and GitHub package sources, plus a
Postgres full-text-search `GIN` index used by catalog search).

1. Make sure `drizzle/` is up to date: `npm run db:generate` should print
   "No schema changes, nothing to migrate" against the schema you're running (CI
   checks this on every push — see `.github/workflows/ci.yml`).
2. Run `npm run db:migrate`. Against an existing `db:push`-managed database, this
   baselines it (see above) and applies anything genuinely new; against a fresh
   database, it applies every migration from scratch. Either way the end state
   matches what `db:push` would have produced.
3. From here on, run `db:migrate` after every schema change instead of `db:push` —
   it's the reviewable, one-file-at-a-time path `drizzle/` was always meant to
   support, now that a `db:push`-created database can adopt it without a manual
   reconciliation step.

`db:push` remains available and still works the same way it always has — useful for
quick local iteration before you've settled on a schema shape — but a deployment
that matters (anything with real data) should be on `db:migrate`.

### Auth.js (GitHub and/or Google OAuth) — enables sign-in, publishing, stars

| Variable | Description |
|---|---|
| `AUTH_SECRET` | Random 32+ byte secret signing session/JWT cookies. Generate with `npx auth secret` or `openssl rand -base64 33`. Shared by both providers. |
| `AUTH_GITHUB_ID` | GitHub OAuth App client id. |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret. |
| `AUTH_GOOGLE_ID` | Google OAuth client id. |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret. |

Each provider is independent — set `AUTH_SECRET` plus either provider's pair, or both
pairs, to enable sign-in. The `/signin` page shows a button per fully-configured
provider, and a "not configured" state when neither is set.

#### GitHub

1. Go to [github.com/settings/developers](https://github.com/settings/developers) →
   **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. **Homepage URL**: your site's URL, e.g. `https://openagents-nu.vercel.app` (or
   `http://localhost:3000` for local dev).
3. **Authorization callback URL**: exactly
   `https://openagents-nu.vercel.app/api/auth/callback/github` (or
   `http://localhost:3000/api/auth/callback/github` for local dev).
4. Copy the **Client ID** / **Client Secret** into `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.

#### Google

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → **APIs &
   Services** → **Credentials** → **Create Credentials** → **OAuth client ID**.
2. Configure the **OAuth consent screen** if prompted: user type **External**, and the
   `email` / `profile` scopes.
3. Create an **OAuth client ID** of type **Web application**.
4. **Authorized redirect URIs**: add exactly
   `https://openagents-nu.vercel.app/api/auth/callback/google` (and
   `http://localhost:3000/api/auth/callback/google` for local dev).
5. Copy the **Client ID** / **Client secret** into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

A signed-in user's handle (`session.user.handle`, stored on `users.handle` when the DB
is enabled) comes from their GitHub login, or — for Google — a slug derived from their
email local-part (lowercased, sanitized to `[a-z0-9-]`, deduplicated with a `-2`, `-3`,
... suffix on collision).

### Stripe Connect — enables paid packages and checkout

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Secret key from the [Stripe dashboard](https://dashboard.stripe.com/apikeys). Use a restricted or test-mode key while developing. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the `/api/webhooks/stripe` endpoint (from the Stripe CLI during local dev, or the Dashboard webhook configuration in production). |
| `PLATFORM_FEE_BPS` | Platform fee in basis points taken from each paid sale. Optional, defaults to `1000` (10%). |

`/api/checkout` and `/api/webhooks/stripe` both return `503 Service Unavailable`
rather than erroring when `STRIPE_SECRET_KEY` is unset — see [API Reference](/docs/api).
Creators receive payouts via **Stripe Connect**, using **Accounts v2**
(`stripe.v2.core.accounts`, not the legacy v1 Express `stripe.accounts.create`)
connected through `/api/connect/onboard` from the hosted `/publish` flow or
`/settings/payouts`; see [Publishing](/docs/publishing) for the fee/content-policy
details.

### Moderation and review

| Variable | Description |
|---|---|
| `ADMIN_HANDLES` | Comma-separated handles granted admin access (`/admin`, `GET /api/v1/admin/queue`, and the admin action routes), in addition to any user with `users.isAdmin` set directly in the database. |
| `REQUIRE_REVIEW` | Set to `1` to require admin approval before a **newly published** package goes live: it's created with `status: "pending"` (visible only to its owner) until approved. Publishing a new version of an already-live package is unaffected. Optional, defaults to off. |

Without either an admin handle or a database row with `isAdmin: true`, `/admin` and
the admin API are simply inaccessible — there's no default admin account.

### Email notifications

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | API key for [Resend](https://resend.com), used to send transactional email. Without it, `src/lib/email.ts` is a no-op — every call site in `src/lib/notify.ts` still runs, it just doesn't send anything, so the app behaves identically to today with this unset. |
| `EMAIL_FROM` | The `From` address used for every email this deployment sends, e.g. `OpenAgents <notifications@yourdomain.com>`. Required alongside `RESEND_API_KEY` for email to actually go out (a missing `EMAIL_FROM` with a key set logs a warning and no-ops, the same as having no key at all). |
| `ADMIN_EMAIL` | Where report notifications are sent. Optional even with the other two set — without it, purchase receipts and sale/status notices to individual users still send; only the admin-facing report email is skipped. |

When configured, notifications go out at the moments in `src/lib/notify.ts`: a
purchase receipt to the buyer, a sale notice to the seller, a report notice to
`ADMIN_EMAIL`, and a status-change notice (approved, unlisted, deprecated) to a
package's owner. Every notification is fire-and-forget — a delivery failure is
logged, never surfaced to the user or allowed to fail the action that triggered it
(a purchase still completes even if the receipt email fails to send).

### GitHub auto-sync

| Variable | Description |
|---|---|
| `SOURCE_WEBHOOK_KEY` | Signing key used to verify inbound GitHub webhook requests for [linked package sources](/docs/publishing#github-auto-sync) (`POST /api/webhooks/github/{id}`). Optional — falls back to `AUTH_SECRET` when unset, so a deployment that already has auth configured needs nothing extra here; set it separately only if you want webhook verification on a distinct key from session signing. |

### Cron jobs

| Variable | Description |
|---|---|
| `CRON_SECRET` | Bearer token Vercel Cron sends as `Authorization: Bearer <CRON_SECRET>` on every scheduled invocation. Required for the three cron routes below to run — without it set, they respond `401` and do nothing (they're never invoked unauthenticated). |

Three routes, scheduled via `vercel.json`'s `crons` config (Vercel sets `CRON_SECRET`
as the bearer token automatically on the hosted deployment — for a self-host on
another platform, wire up your own scheduler to call these on the same cadence with
the same header):

| Route | Schedule | Does |
|---|---|---|
| `POST /api/cron/rollup-downloads` | Daily | Aggregates the prior UTC day's `download_events` into the `download_rollups` table — per package/day, with per-runtime and per-version breakdowns — so `/dashboard` and `sort=trending` don't scan raw events as they grow. |
| `POST /api/cron/cleanup` | Hourly | Expires stale rate-limit windows and prunes abandoned checkout artifacts. |
| `POST /api/cron/review-reminders` | Daily | Emails a reminder for packages that have sat in the pending-review or scan-flagged queue past a threshold (via `src/lib/notify.ts` — a no-op without `RESEND_API_KEY`, same as every other notification). |

See [API Reference](/docs/api#cron-jobs) for the request/response shape. Without
`DATABASE_URL` configured, there's nothing for these to roll up or clean, and
`rollup-downloads`/`cleanup` are effectively no-ops (still `200`, just
`processed: 0`).

### Analytics

| Variable | Description |
|---|---|
| `DOWNLOAD_HASH_SALT` | Salt mixed into the per-day client hash used to dedupe download counts (see `src/lib/analytics.ts`). Optional — downloads are still deduped per-client-per-day without it (the UTC day alone still prevents joining the hash across days); set it for a production deployment so the hash can't be brute-forced back to an IP. Rotating it invalidates all existing per-day dedupe hashes. |

### Error monitoring

| Variable | Description |
|---|---|
| `SENTRY_DSN` | Sentry DSN, e.g. `https://<publicKey>@<host>/<projectId>`, from a Sentry project's **Client Keys** settings. Optional. |

Every server error is captured through `src/instrumentation.ts`'s `onRequestError`
into `src/lib/monitoring.ts`'s `captureError()`, which **always** logs one line of
structured JSON to stderr — so `vercel logs` / `docker logs` / `journalctl` is a
working error log with zero configuration. When `SENTRY_DSN` is set, the same error
is additionally POSTed to Sentry's ingest endpoint by hand (no `@sentry/nextjs`
dependency — this project stays on the zero-extra-bundle path described throughout
this doc), with a 2-second timeout; a slow or unreachable Sentry never delays or
fails the request that triggered the error. This is intentionally minimal: no
breadcrumbs, no performance tracing, no session replay — just "an error happened,
here's the message and stack." If you need more, swap `sendToSentry` in
`src/lib/monitoring.ts` for the real `@sentry/nextjs` SDK; `captureError()`'s
call sites don't need to change.

### Content-Security-Policy

`next.config.ts` now sends an **enforcing** `Content-Security-Policy` header (no
longer `-Report-Only`), with a fresh nonce generated per request:

```
script-src 'self' 'nonce-<per-request>' 'strict-dynamic' https://js.stripe.com;
frame-src https://js.stripe.com;
img-src 'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com https://*.stripe.com;
connect-src 'self' https://api.stripe.com https://*.sentry.io;
```

(plus the standard `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`
directives — see `next.config.ts`'s `headers()` function for the exact policy
string). Enforcing this required two things that are now in place: every
server-rendered `<script>` tag (including Next's own hydration bootstrap) is nonced
via middleware, and creator-supplied READMEs render through `react-markdown` with
raw HTML disabled, so injected `<script>`/`on*=` content in a README can't execute
regardless of the header.

If you fork this project and add your own inline `<script>` tags (a custom
analytics snippet, say), either thread the request's nonce onto them the same way
`next.config.ts` does for its own, or relax `script-src` for your deployment —
an un-nonced inline script is silently blocked under the shipped policy, not a
build error, so check your browser's devtools console after adding one.

### Site

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Public base URL used to build absolute links: Stripe redirect URLs, OAuth callbacks, and — the canonical URL, sitemap, robots.txt, and `og:image` URLs. When unset, it falls back to the Vercel production deployment URL, and then to `http://localhost:3000` if that isn't available either — so links are still self-consistent on a preview/self-hosted deployment that hasn't set this explicitly, but set it in production so canonical/OG URLs point at your real domain regardless of which edge region or preview alias served the request. |

## Local development

```bash
git clone <your fork>
cd openagents
npm install
cp .env.example .env.local   # optional — fill in only what you need
npm run dev
```

Visit `http://localhost:3000`. With `.env.local` empty, you get the seed-catalog-only
experience described above — a good way to verify the zero-config baseline before
layering on database/auth/payments.

## End-to-end tests

```bash
npm run test:e2e
```

A Playwright suite (see `docs/E2E.md` for the full breakdown of what's covered) that
drives the built app in a real browser — install, search, publish, and checkout
flows — rather than just unit-testing route handlers. CI runs it against a
**zero-env build** (no `DATABASE_URL`/auth/Stripe configured), the same zero-config
baseline described throughout this doc, so it doubles as a regression check that the
app still degrades gracefully with nothing set. Run it locally before opening a PR
that touches UI — see [Contributing](https://github.com/WolfeIntelligence/openagents/blob/main/CONTRIBUTING.md).

## Choosing what to enable

| You want... | Set |
|---|---|
| Just the free catalog, browsable and installable via CLI | nothing |
| Community members can publish free packages too, tracked in a DB instead of only via PR | `DATABASE_URL` |
| Sign-in, stars, creator profiles | + `AUTH_SECRET`, and `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET` and/or `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` |
| Paid packages, Stripe Connect payouts | + `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| A moderation queue and admin approval before new packages go live | + `ADMIN_HANDLES` and/or an `isAdmin` row, `REQUIRE_REVIEW` |
| Purchase/sale/report/status emails | + `RESEND_API_KEY`, `EMAIL_FROM`, and optionally `ADMIN_EMAIL` |
| Auto-republish on a linked GitHub repo's release/tag | nothing extra — `SOURCE_WEBHOOK_KEY` is optional, falls back to `AUTH_SECRET` |
| Errors also forwarded to Sentry (not just stderr) | + `SENTRY_DSN` |
| Download rollups, trending, and admin analytics kept current by cron | + `DATABASE_URL`, `CRON_SECRET` |

Each tier is additive — nothing above it is required to run the tier below it, and
every route degrades gracefully rather than 500ing when its dependencies aren't
configured.
