# OpenAgents

**An open-source marketplace for agentic workflows, harnesses, rules, and skills.**

Think Hugging Face, but the artifacts are packaged agent behaviors instead of model
weights. Creators publish packages — structured procedures, safety scaffolding,
standing rule sets, reusable skills — some free, some paid. You browse, install, and
run them in your own agent runtime: Claude Code, Cursor, Codex CLI, the OpenAI Agents
SDK, LangGraph, or anything else via a generic install layout.

```bash
npx openagents add openagents/pr-reviewer
```

## What's in a package

A package is a directory with an `openagent.yaml` manifest, a `README.md`, and
whatever files it needs — instruction text, checklists, templates, JSON schemas,
scripts. Four kinds cover everything in the catalog:

| kind | what it is |
|---|---|
| `workflow` | A multi-step, goal-directed procedure an agent executes (e.g. "review this PR"). |
| `harness` | Scaffolding around an agent: loop control, tool wiring, eval hooks, guards. |
| `rules` | Constraints / style / policy files an agent must obey (e.g. a CLAUDE.md set). |
| `skill` | A reusable capability with its own instructions + helper scripts. |

Free packages ship bundled with the project under `catalog/openagents/`, spanning all
four kinds: workflows (PR review, migration review, flaky-test triage, performance
investigation, incident postmortems, repo onboarding, changelog generation, dependency
upgrades), harnesses (eval suites, tool budgets, approval gates, context compaction,
a red/green test loop, agent guardrails), rules (TypeScript, Python, SQL safety,
accessibility, technical writing, secure coding, commit conventions), and skills
(query-plan reading, log triage, dataset profiling, API design review, research
briefs). Browse them at [`/explore`](https://openagents-nu.vercel.app/explore) or list
them with the CLI:

```bash
npx openagents search ""
npx openagents info openagents/pr-reviewer
```

## Quickstart (development)

```bash
git clone https://github.com/WolfeIntelligence/openagents.git
cd openagents
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app builds and runs with
**zero environment variables set** — you get the full site backed by the bundled seed
catalog, with the database-backed catalog, sign-in, and payments simply disabled until
configured. Copy [`.env.example`](./.env.example) to `.env.local` to layer on a
database, GitHub/Google auth, and Stripe Connect payments — see
[`src/content/docs/self-hosting.md`](./src/content/docs/self-hosting.md)
(or `/docs/self-hosting` once running) for the full environment variable reference.

```bash
npx tsc --noEmit && npm run lint && npm run check:catalog && npm test --if-present
```

runs the same checks as CI (see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)),
which also builds the site with zero env vars set to guard the zero-config promise
above, and separately smoke-tests the CLI in [`cli/`](./cli).

### CLI

The `openagents` CLI is a separate, standalone npm package in [`cli/`](./cli) with no
runtime dependency on the rest of this repo:

```bash
cd cli
npm install
node bin/openagents.js --help
```

See [`cli/README.md`](./cli/README.md) for every command.

## Architecture

- **Next.js (App Router), TypeScript, Tailwind** — dark-first, dense, developer-tool
  aesthetic, deployed on Vercel.
- **Catalog abstraction** (`src/lib/catalog/index.ts`) — a `seed` implementation reads
  free packages from `/catalog/<owner>/<name>/` on disk at build time (always
  available, zero config); a `db` implementation (Drizzle ORM + Postgres/Neon) is
  enabled when `DATABASE_URL` is set and merges DB-backed packages with the seed
  catalog.
- **Auth** — Auth.js v5 with GitHub and Google providers, each enabled independently
  once its own env vars are present; the app never crashes without them.
- **Payments** — Stripe Connect for paid packages, one-time or **subscription**
  (`pricing.model: subscription`, billed monthly or yearly), with a configurable
  platform fee (default 10%) taken on every charge — including every subscription
  renewal, via `application_fee_percent`. Connected accounts use **Stripe Accounts
  v2** (`stripe.v2.core.accounts`), not the legacy v1 Express flow
  (`stripe.accounts.create`); checkout, the billing portal
  (`POST /api/billing/portal`), and webhook routes return `503` rather than erroring
  when Stripe isn't configured. Paid packages are gated at the file level — only
  `README.md` and `openagent.yaml` are readable before purchase.
- **Distribution** — every package is downloadable as a tarball, pinned to a version
  or latest (`/api/v1/packages/{owner}/{name}/download`,
  `.../versions/{version}/download`), with an `ETag`/`X-Checksum-Sha256` pair the CLI
  verifies on install. `npx openagents add owner/name[@version|@range]` resolves
  `requires` transitively. Packages can ship binary files (base64-encoded, POSIX mode
  preserved through the tarball) alongside text, up to 2 MB total binary content.
- **API tokens, lifecycle, reviews, analytics** — personal access tokens
  (`/settings/tokens`) for the CLI and third-party clients; a package moderation
  lifecycle (`pending`/`live`/`unlisted`/`deprecated`, an admin queue at `/admin`,
  anonymous reporting); star ratings + written reviews; per-package download/star
  analytics on a seller `/dashboard`. See [API Reference](./src/content/docs/api.md).
- **Collections** — curated, ordered lists of packages (`/collections`,
  `/c/{handle}/{slug}`) a user or an admin puts together, each installable in one
  paste via a generated "copy install-all" command.
- **GitHub auto-sync** — a package can be linked to a GitHub repository
  (`/settings/sources`) so a new release or tag push republishes it automatically via
  an inbound webhook, instead of running `openagents publish` by hand each time.
- **Durable rate limiting** — download/star/report/publish/checkout/token routes are
  rate-limited against a shared Postgres-backed counter when `DATABASE_URL` is set
  (falling back to a best-effort in-memory limiter otherwise), so a limit holds
  across every serverless instance rather than resetting per cold start.
- **Enforced Content-Security-Policy** — a strict, nonce-based CSP is sent on every
  response (not report-only), with creator READMEs rendered through
  `react-markdown` with raw HTML disabled.
- **Sharing & SEO** — per-package/creator Open Graph images, embeddable SVG status
  badges, `SoftwareSourceCode` JSON-LD on package pages, and an RSS feed
  (`/feed.xml`).
- **Email notifications** — purchase receipts, sale notices, report notices, and
  status-change notices via Resend (`RESEND_API_KEY`); a no-op without it.
- **Account data controls** — export everything tied to an account as JSON
  (`GET /api/v1/account/export`) or delete the account outright
  (`DELETE /api/v1/account`, blocked while it owns packages with sales or holds an
  active subscription).
- **Schema migrations** — `src/lib/db/schema.ts` is versioned as Drizzle SQL
  migrations checked into `drizzle/` (`npm run db:generate` after a schema edit; CI
  fails if `drizzle/` drifts from the schema). `npm run db:migrate` is the
  recommended way to apply them — including on the hosted deployment — and
  automatically baselines a database that was previously set up with `db:push`; see
  [Self-Hosting](./src/content/docs/self-hosting.md#schema-migrations) for exactly
  what that means.
- **Error monitoring** — every server error is logged as structured JSON to stderr;
  set `SENTRY_DSN` to also forward it to Sentry, no `@sentry/nextjs` dependency
  required (see `src/instrumentation.ts`, `src/lib/monitoring.ts`).

Full technical spec, routes, and directory layout: **[SPEC.md](./SPEC.md)**.

## Documentation

Once running, browse `/docs` in the app, or read the source directly under
[`src/content/docs/`](./src/content/docs/): [Getting Started](./src/content/docs/getting-started.md),
[Package Format](./src/content/docs/package-format.md), [Kinds](./src/content/docs/kinds.md),
[Runtimes](./src/content/docs/runtimes.md), [CLI](./src/content/docs/cli.md),
[Publishing](./src/content/docs/publishing.md), [API Reference](./src/content/docs/api.md)
(also machine-readable as [OpenAPI 3.1](./public/openapi.json), or `GET /api/v1/openapi`),
[Self-Hosting](./src/content/docs/self-hosting.md).

## Contributing

The easiest contribution is a new free package: see **[CONTRIBUTING.md](./CONTRIBUTING.md)**
for the full guide and quality bar. Short version: fork, add
`catalog/<your-handle>/<package-name>/` with a valid `openagent.yaml` and README, run
`openagents validate <dir>` to check it, and open a PR.

## License

[MIT](./LICENSE) © 2026 OpenAgents contributors. Individual packages in the catalog
may declare their own license in `openagent.yaml` (paid/proprietary packages use
`license: proprietary`) — check a package's manifest before redistributing its
contents.
