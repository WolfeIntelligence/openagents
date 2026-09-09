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
3. Push the schema:
   ```
   npm run db:push
   ```
   (Use `npm run db:generate` instead if you want migration files checked into
   `./drizzle` rather than pushing the schema directly; then apply them with your
   preferred migration step.)
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

1. Create/use a Stripe account, enable **Connect** (Dashboard → Connect → Get started;
   Express accounts are what `createConnectOnboardingLink` creates).
2. Copy your **Secret key** (test mode while developing) into `STRIPE_SECRET_KEY`.
3. Local webhook testing with the Stripe CLI:
   ```
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   This prints a `whsec_...` value — set that as `STRIPE_WEBHOOK_SECRET`.
   In production, create the webhook endpoint in the Dashboard (Developers → Webhooks →
   Add endpoint) pointed at `<site-url>/api/webhooks/stripe`, subscribed to
   `checkout.session.completed` (records purchases) and `account.updated` (flips
   `users.stripeOnboarded` once a connected seller finishes onboarding), and use the
   signing secret it gives you.
4. Optional: set `PLATFORM_FEE_BPS` (basis points taken from each sale; default `1000` =
   10%).
5. Sellers connect their account via `POST /api/connect/onboard` (requires sign-in),
   which returns a Stripe-hosted onboarding link.

## Commands reference

| command             | purpose                                      |
|----------------------|----------------------------------------------|
| `npm run db:generate` | generate SQL migration files into `./drizzle` |
| `npm run db:push`     | push the Drizzle schema straight to `DATABASE_URL` |
| `npm run db:studio`   | open Drizzle Studio against `DATABASE_URL`    |
