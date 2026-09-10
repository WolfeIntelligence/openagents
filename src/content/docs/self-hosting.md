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
Run migrations with Drizzle (`drizzle.config.ts` at the repo root) before the first
deploy with a database attached.

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

Each tier is additive — nothing above it is required to run the tier below it, and
every route degrades gracefully rather than 500ing when its dependencies aren't
configured.
