# Setup: database, auth, payments

OpenAgents runs with zero configuration (seed catalog only). This doc covers turning on
each optional layer. Copy `.env.example` to `.env.local` and fill in the values as you
go — the app re-detects what's configured on each request, no build-time flag needed.

## 1. Database (Neon Postgres via Vercel Marketplace)

1. In the Vercel dashboard, open your project → **Storage** → **Create Database** →
   choose **Neon** (Postgres) from the Marketplace tab and follow the prompts.
2. Vercel adds a `DATABASE_URL` env var to the project automatically. For local dev,
   pull it down with `vercel env pull .env.local`, or copy the connection string from
   the Neon dashboard into `.env.local` yourself.
3. Apply the schema:
   ```
   npm run db:migrate
   ```
   This is now the recommended path, including for the hosted deployment — it
   applies every pending migration under `./drizzle` to `DATABASE_URL`. Running it
   the first time against a database that was previously set up with `db:push`
   automatically **baselines** it (detects the existing schema matches, marks the
   relevant migrations as already applied, and only actually runs anything genuinely
   new) — see "Schema migrations" → "Baselining a `db:push`-created database" in
   `src/content/docs/self-hosting.md` for exactly what that does. `npm run db:push`
   still works for quick local iteration, but reach for `db:migrate` for anything
   with real data.
4. Optional: `npm run db:studio` opens Drizzle Studio against `DATABASE_URL` to browse
   data.

Once `DATABASE_URL` is set, the catalog automatically merges DB packages with the seed
catalog, and `/api/v1/publish` starts working.

## 2. Sign-in (Auth.js) — GitHub and/or Google

`AUTH_SECRET` is shared by both providers; enable either provider by setting its two
client env vars, or enable both. The sign-in page (`/signin`) shows one button per
provider that's fully configured, and a "not configured" state if neither is.

Production example host: `https://openagents-nu.vercel.app`. For local dev, use
`http://localhost:3000`.

1. Generate `AUTH_SECRET`:
   ```
   npx auth secret
   ```
   or `openssl rand -base64 33`, and set it.

### GitHub

1. Go to https://github.com/settings/developers → **Developer settings** → **OAuth
   Apps** → **New OAuth App**.
2. **Homepage URL**: your site's URL, e.g. `https://openagents-nu.vercel.app`
   (or `http://localhost:3000` for local dev).
3. **Authorization callback URL**: `https://openagents-nu.vercel.app/api/auth/callback/github`
   (or `http://localhost:3000/api/auth/callback/github` for local dev).
4. Copy the generated **Client ID** and **Client Secret** into `AUTH_GITHUB_ID` /
   `AUTH_GITHUB_SECRET`.

### Google

1. Go to https://console.cloud.google.com/ → **APIs & Services** → **Credentials** →
   **Create Credentials** → **OAuth client ID**.
2. If prompted, configure the **OAuth consent screen** first: choose **External**,
   fill in the required app fields, and add the `email` and `profile` scopes (both are
   included by default under "Non-sensitive scopes").
3. Back in **Credentials**, create an **OAuth client ID** of type **Web application**.
4. **Authorized redirect URIs**: add exactly
   `https://openagents-nu.vercel.app/api/auth/callback/google`
   (and `http://localhost:3000/api/auth/callback/google` for local dev).
5. Copy the generated **Client ID** and **Client secret** into `AUTH_GOOGLE_ID` /
   `AUTH_GOOGLE_SECRET`.

With `AUTH_SECRET` and at least one provider's pair set, sign-in is enabled. A signed-in
user's handle (`session.user.handle`, stored on `users.handle` when the DB is enabled)
comes from their GitHub login, or — for Google — a slug derived from their email
local-part (lowercased, non `[a-z0-9-]` characters replaced with `-`, deduplicated with
a `-2`, `-3`, ... suffix on collision).

## 3. Stripe Connect + webhook

Connect accounts are created with **Stripe Accounts v2** (`stripe.v2.core.accounts`, a
`recipient` configuration with the `stripe_balance.stripe_transfers` capability
requested, `dashboard: "express"`) — v1 Accounts (`stripe.accounts.create`) are no
longer accepted for new Connect integrations. See
https://docs.stripe.com/connect/accounts-v2/account-creation.

1. Create/use a Stripe account, enable **Connect** (Dashboard → Connect → Get started;
   Express-dashboard recipient accounts are what `createConnectOnboardingLink` creates).
2. Copy your **Secret key** (test mode while developing) into `STRIPE_SECRET_KEY`.
3. Local webhook testing with the Stripe CLI:
   ```
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   This prints a `whsec_...` value — set that as `STRIPE_WEBHOOK_SECRET`.
   In production, create the webhook endpoint in the Dashboard (Developers → Webhooks →
   Add endpoint) pointed at `<site-url>/api/webhooks/stripe`, subscribed to:
   - `checkout.session.completed` (records purchases; v1 snapshot event)
   - `account.updated` (v1 snapshot event; harmless legacy fallback)
   - `v2.core.account[configuration.recipient].capability_status_updated` (v2 thin
     event — recipient's `stripe_balance.stripe_transfers` capability changed status)
   - `v2.core.account[configuration.recipient].updated` (v2 thin event — recipient
     configuration changed)
   - `v2.core.account[requirements].updated` (v2 thin event — outstanding requirements
     changed)

   The last three flip `users.stripeOnboarded` via `getConnectedAccountStatus` once a
   connected seller finishes onboarding; use the same signing secret for all of them.
4. Optional: set `PLATFORM_FEE_BPS` (basis points taken from each sale; default `1000` =
   10%).
5. Sellers connect their account via `POST /api/connect/onboard` (requires sign-in),
   which returns a Stripe-hosted onboarding link.

## 4. Moderation, review, and analytics (optional)

| Variable | Effect |
|---|---|
| `ADMIN_HANDLES` | Comma-separated handles granted `/admin` access, alongside any user with `users.isAdmin` set in the database. |
| `REQUIRE_REVIEW` | `1` to hold newly published packages as `pending` until an admin approves them from `/admin`. |
| `DOWNLOAD_HASH_SALT` | Salts the per-day, per-client hash used to dedupe download counts. |
| `SENTRY_DSN` | When set, errors are also forwarded to Sentry in addition to the always-on stderr log — see `src/instrumentation.ts` / `src/lib/monitoring.ts`. |

## 5. Email notifications (optional)

| Variable | Effect |
|---|---|
| `RESEND_API_KEY` | [Resend](https://resend.com) API key. Without it, notification sending is a no-op — nothing breaks, emails just don't go out. |
| `EMAIL_FROM` | The `From` address for every email this deployment sends. Required alongside `RESEND_API_KEY`. |
| `ADMIN_EMAIL` | Where report notifications land. Optional; other notification types don't need it. |

Sends: a purchase receipt to the buyer, a sale notice to the seller, a report notice
to `ADMIN_EMAIL`, and a status-change notice to a package's owner — see
`src/lib/notify.ts` / `src/lib/email.ts`.

## 6. GitHub auto-sync (optional)

| Variable | Effect |
|---|---|
| `SOURCE_WEBHOOK_KEY` | Signing key for verifying `POST /api/webhooks/github/{id}` requests. Optional — falls back to `AUTH_SECRET` when unset. |

See "GitHub auto-sync" in `src/content/docs/publishing.md` for linking a package to
a repo so a release/tag push republishes it automatically.

## 7. Cron jobs (rollups, cleanup, review reminders)

| Variable | Effect |
|---|---|
| `CRON_SECRET` | Bearer token the three `/api/cron/*` routes require (`Authorization: Bearer <CRON_SECRET>`); without it they 401 and never run. |

Vercel's Cron scheduler (configured in `vercel.json`) calls these on a fixed
schedule and injects `CRON_SECRET` as the bearer token automatically on the hosted
deployment:

| Route | Schedule |
|---|---|
| `POST /api/cron/rollup-downloads` | Daily — aggregates `download_events` into `download_rollups` for the previous UTC day. |
| `POST /api/cron/cleanup` | Hourly — expires stale rate-limit rows and abandoned checkout artifacts. |
| `POST /api/cron/review-reminders` | Daily — reminder emails for packages stuck in review/scan-flagged status. |

See `src/content/docs/self-hosting.md#cron-jobs` for the full detail and
`src/content/docs/api.md#ops` for the request/response shape.

## 8. Running the test suite

```
npm run test:e2e
```

Runs the Playwright end-to-end suite (see `docs/E2E.md`) against a locally-built
app. CI runs the same suite against a **zero-env build** — no database, auth, or
Stripe configured — so it also verifies the zero-config baseline still works.

## Commands reference

| command             | purpose                                      |
|----------------------|----------------------------------------------|
| `npm run db:generate` | diff `src/lib/db/schema.ts` against `./drizzle` and write a new migration file if it changed (offline, no `DATABASE_URL` needed) |
| `npm run db:migrate`  | apply pending migrations under `./drizzle` to `DATABASE_URL` — the recommended path; baselines a `db:push`-created database automatically the first time it runs against one (see `src/content/docs/self-hosting.md#schema-migrations`) |
| `npm run db:push`     | push the Drizzle schema straight to `DATABASE_URL`, skipping the migrations folder — fine for quick local iteration, but prefer `db:migrate` for anything with real data |
| `npm run db:studio`   | open Drizzle Studio against `DATABASE_URL`    |
| `npx drizzle-kit check` | verify `./drizzle`'s migration journal/snapshots are internally consistent (does **not** detect drift against the live schema — CI uses `db:generate` + `git diff` for that) |
