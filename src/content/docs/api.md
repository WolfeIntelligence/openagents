---
title: API Reference
description: Every /api/v1 endpoint — example curl calls and response shapes.
order: 7
---

# API Reference

All endpoints are JSON over HTTPS, unauthenticated for reads. The base URL is your
deployment's origin (`https://openagents.vercel.app` for the hosted instance, or
`OPENAGENTS_REGISTRY` if you're pointing the CLI elsewhere).

Types below are simplified TypeScript shapes; the authoritative types are
`src/lib/types.ts` in the repo (`Manifest`, `Package`, `PackageSummary`,
`CatalogPage`, `Pricing`, `PackageInput`).

## `GET /api/v1/packages`

List/filter packages — the same query parameters as [`/explore`](/explore).

**Query parameters** (all optional): `q` (text search), `kind`
(`workflow`\|`harness`\|`rules`\|`skill`), `runtime` (a runtime id), `price`
(`free`\|`paid`), `tag`, `owner`, `sort` (`downloads`\|`stars`\|`updated`\|`name`),
`limit`, `offset`.

```bash
curl "https://openagents.vercel.app/api/v1/packages?kind=workflow&price=free&sort=stars&limit=10"
```

```ts
// 200 OK
{
  items: Array<{
    id: string;              // "owner/name"
    owner: string;
    name: string;
    title: string;
    summary: string;
    kind: "workflow" | "harness" | "rules" | "skill";
    tags: string[];
    runtimes: string[];
    pricing: { model: "free" | "one-time" | "subscription"; amountCents: number; currency: string };
    version: string;
    license: string;
    stats: { downloads: number; stars: number };
    featured: boolean;
    source: "seed" | "db";
    updatedAt: string; // ISO date
  }>;
  total: number;
}
```

## `GET /api/v1/packages/{owner}/{name}`

Fetch one package: full manifest, README, file list, and version history.

```bash
curl "https://openagents.vercel.app/api/v1/packages/openagents/pr-reviewer"
```

```ts
// 200 OK
{
  id: "openagents/pr-reviewer";
  owner: "openagents";
  name: "pr-reviewer";
  manifest: Manifest;              // full parsed openagent.yaml, camelCase
  readme: string;                  // README.md contents, markdown
  files: Array<{ path: string; size: number }>;
  versions: Array<{ version: string; publishedAt: string; changelog?: string }>;
  stats: { downloads: number; stars: number };
  featured: boolean;
  source: "seed" | "db";
  createdAt: string;
  updatedAt: string;
}
// 404 Not Found if owner/name doesn't exist
```

## `GET /api/v1/packages/{owner}/{name}/download`

Download the package's files as a `.tar.gz`. This is what `openagents add` fetches
after reading the manifest.

```bash
curl -OJ "https://openagents.vercel.app/api/v1/packages/openagents/pr-reviewer/download"
```

Response: `200 OK`, `Content-Type: application/gzip`, a tarball containing every file
listed in the package's `manifest.files` (plus `openagent.yaml` and `README.md`).
`404 Not Found` if the package doesn't exist.

## `GET /api/v1/search`

Full-text search across title, summary, and tags.

```bash
curl "https://openagents.vercel.app/api/v1/search?q=code+review"
```

```ts
// 200 OK — same item shape as /api/v1/packages
{
  items: PackageSummary[];
  total: number;
}
```

`q` is required; an empty/missing `q` returns `400 Bad Request`.

## `GET/POST /api/auth/[...nextauth]`

Auth.js (GitHub provider) sign-in, callback, and session endpoints. Only functional
when `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and `AUTH_SECRET` are set — see
[Self-Hosting](/docs/self-hosting). Without them, the sign-in UI shows a
"not configured" state rather than erroring; the app never crashes for missing auth
env vars.

## `POST /api/checkout`

Creates a Stripe Checkout session for a paid package purchase.

```bash
curl -X POST "https://openagents.vercel.app/api/checkout" \
  -H "Content-Type: application/json" \
  -d '{"owner": "someone", "name": "their-paid-package"}'
```

```ts
// 200 OK
{ url: string } // redirect the buyer here to complete checkout

// 503 Service Unavailable — when STRIPE_SECRET_KEY isn't configured on this deployment
{ error: "payments are not enabled on this deployment" }
```

## `POST /api/webhooks/stripe`

Stripe webhook receiver — handles `checkout.session.completed` and related events to
record a purchase and trigger the Connect transfer (minus the platform fee; see
[Publishing](/docs/publishing)). Verified against `STRIPE_WEBHOOK_SECRET`. Called by
Stripe, not by clients directly.

```ts
// 503 Service Unavailable — when Stripe isn't configured on this deployment
{ error: "payments are not enabled on this deployment" }
```

## `POST /api/v1/publish`

Submit a package (manifest + files) for publishing. Free packages should generally go
through a pull request instead (see [Publishing](/docs/publishing)); this endpoint is
the programmatic path for paid packages, and requires an authenticated session with a
connected Stripe account for anything with `pricing.model != "free"`.

```bash
curl -X POST "https://openagents.vercel.app/api/v1/publish" \
  -H "Content-Type: application/json" \
  -H "Cookie: <session cookie>" \
  -d '{
        "manifest": { "schema": 1, "name": "my-package", "owner": "me", "...": "..." },
        "files": { "WORKFLOW.md": "...", "README.md": "..." }
      }'
```

```ts
// 200 OK
{ id: "me/my-package", status: "pending_review" }

// 401 Unauthorized — no session
// 400 Bad Request — manifest fails validation (see Package Format)
```

The CLI's `openagents publish` currently just prints this endpoint and the `/publish`
URL rather than calling it directly — see [CLI Reference](/docs/cli).

## Error shape

Non-2xx responses across all endpoints return:

```ts
{ error: string }
```

with an appropriate HTTP status (`400`, `401`, `404`, `503`).
