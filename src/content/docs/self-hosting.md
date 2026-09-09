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

### Auth.js (GitHub OAuth) — enables sign-in, publishing, stars

| Variable | Description |
|---|---|
| `AUTH_SECRET` | Random 32+ byte secret signing session/JWT cookies. Generate with `npx auth secret` or `openssl rand -base64 33`. |
| `AUTH_GITHUB_ID` | GitHub OAuth App client id. |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret. |

Create the OAuth App at [github.com/settings/developers](https://github.com/settings/developers)
with an **Authorization callback URL** of
`<NEXT_PUBLIC_SITE_URL>/api/auth/callback/github`. Without all three set, the sign-in
UI renders a "not configured" state rather than a broken button.

### Stripe Connect — enables paid packages and checkout

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Secret key from the [Stripe dashboard](https://dashboard.stripe.com/apikeys). Use a restricted or test-mode key while developing. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the `/api/webhooks/stripe` endpoint (from the Stripe CLI during local dev, or the Dashboard webhook configuration in production). |
| `PLATFORM_FEE_BPS` | Platform fee in basis points taken from each paid sale. Optional, defaults to `1000` (10%). |

`/api/checkout` and `/api/webhooks/stripe` both return `503 Service Unavailable`
rather than erroring when `STRIPE_SECRET_KEY` is unset — see [API Reference](/docs/api).
Creators receive payouts via **Stripe Connect Express accounts**, connected through
the hosted `/publish` flow; see [Publishing](/docs/publishing) for the fee/review
details.

### Site

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Public base URL used to build absolute links (Stripe redirect URLs, OAuth callbacks). Defaults to the incoming request's origin when unset — set this explicitly in production for consistent links regardless of which edge region served the request. |

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
| Sign-in, stars, creator profiles | + `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` |
| Paid packages, Stripe Connect payouts | + `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

Each tier is additive — nothing above it is required to run the tier below it, and
every route degrades gracefully rather than 500ing when its dependencies aren't
configured.
