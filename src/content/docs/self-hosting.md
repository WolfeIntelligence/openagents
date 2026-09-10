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

#### Schema migrations

The schema (`src/lib/db/schema.ts`) is versioned as Drizzle SQL migrations checked
into `drizzle/` — commit that directory, don't `.gitignore` it away in a fork.

| Command | When |
|---|---|
| `npm run db:generate` | After every schema edit. Diffs `src/lib/db/schema.ts` against the last migration snapshot and writes a new file under `drizzle/` (or nothing, if there's no drift). Runs entirely offline — no `DATABASE_URL` needed. |
| `npm run db:migrate` | Applies any not-yet-applied migrations in `drizzle/` to `DATABASE_URL`. *(Not present in `package.json` today — see the note below.)* |
| `npm run db:push` | Pushes the current schema straight to `DATABASE_URL`, skipping the migrations folder entirely. |
| `npm run db:studio` | Opens Drizzle Studio against `DATABASE_URL` to browse data. |

**The hosted deploy still uses `db:push` today**, not a `db:generate`/`db:migrate`
pipeline — `drizzle/` exists so migrations *can* be reviewed and applied
deliberately, but nothing currently runs `db:migrate` in CI or at deploy time. To
switch a deployment over:

1. Make sure `drizzle/` is up to date: `npm run db:generate` should print
   "No schema changes, nothing to migrate" against the schema you're running (CI
   checks this on every push — see `.github/workflows/ci.yml`).
2. Add a `db:migrate` script that runs Drizzle's migrator against `DATABASE_URL`
   (`drizzle-orm/neon-http/migrator`'s `migrate()`, pointed at `./drizzle`) — see
   Drizzle's [migrations guide](https://orm.drizzle.team/docs/migrations) for the
   Neon HTTP driver specifically, since this project's `getDb()` uses
   `@neondatabase/serverless` over HTTP, not a pooled TCP connection.
3. Run that script as a release step (a Vercel deploy hook, or manually) instead of
   `db:push` going forward. Until then, `db:push` remains correct to run after
   pulling schema changes — it's just not reviewable/rollback-able the way applying
   `drizzle/*.sql` one file at a time is.

The very first migration (`drizzle/0000_*.sql`) was generated from the schema as of
this doc's writing and covers every table that exists today; a fresh database can
either run it via `db:migrate` (once wired up) or just use `db:push`, which produces
the same end state.

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

`next.config.ts` sends a `Content-Security-Policy-Report-Only` header on every
response — **report-only, not enforcing**. It's not yet safe to enforce because (1)
this version of Next.js emits inline bootstrap/hydration `<script>` tags with no
nonce, so an enforcing `script-src` would break every page without a nonce-wiring
change, and (2) creator-supplied READMEs are rendered through `react-markdown` and
haven't yet been audited for injected `<script>`/`on*=` content. See the comment
above the `headers()` function in `next.config.ts` for the exact plan to flip it to
enforcing. Point your browser's devtools console at a deployment to see any
violations it would currently cause — none should block rendering, since nothing is
blocked yet.

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

## Choosing what to enable

| You want... | Set |
|---|---|
| Just the free catalog, browsable and installable via CLI | nothing |
| Community members can publish free packages too, tracked in a DB instead of only via PR | `DATABASE_URL` |
| Sign-in, stars, creator profiles | + `AUTH_SECRET`, and `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET` and/or `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` |
| Paid packages, Stripe Connect payouts | + `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| A moderation queue and admin approval before new packages go live | + `ADMIN_HANDLES` and/or an `isAdmin` row, `REQUIRE_REVIEW` |
| Errors also forwarded to Sentry (not just stderr) | + `SENTRY_DSN` |

Each tier is additive — nothing above it is required to run the tier below it, and
every route degrades gracefully rather than 500ing when its dependencies aren't
configured.
