---
title: API Reference
description: Every /api/v1 endpoint — example curl calls and response shapes.
order: 7
---

# API Reference

All endpoints are JSON over HTTPS, unauthenticated for reads. The base URL is your
deployment's origin (`https://openagents-nu.vercel.app` for the hosted instance, or
`OPENAGENTS_REGISTRY` if you're pointing the CLI elsewhere).

Types below are simplified TypeScript shapes; the authoritative types are
`src/lib/types.ts` in the repo (`Manifest`, `Package`, `PackageSummary`,
`CatalogPage`, `Pricing`, `PackageInput`).

Any request under `/api/v1/*` that doesn't match a defined route (a typo'd path, a
trailing segment that doesn't exist) returns a JSON `404` — `{ error: "not found" }` —
rather than the framework's HTML 404 page.

## `GET /api/v1/packages`

List/filter packages — the same query parameters as [`/explore`](/explore).

**Query parameters** (all optional): `q` (text search), `kind`
(`workflow`\|`harness`\|`rules`\|`skill`), `runtime` (a runtime id), `price`
(`free`\|`paid`), `tag`, `owner`, `sort` (`downloads`\|`stars`\|`updated`\|`name`),
`limit` (default `24`, max `100`), `offset`.

`q` is tokenized on whitespace: every word must match somewhere for a package to be
included (an AND, not an OR, across terms). Each term is checked against `name`,
`title`, `summary`, `owner`, and `tags` — a hyphenated tag like `code-review` matches
the term `review` or `code` on either side of the hyphen, since hyphens in tags are
treated as spaces for matching purposes. Results are ranked with name/title matches
first, then summary/owner/tag matches, ties broken by the package's normal sort order.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages?kind=workflow&price=free&sort=stars&limit=10"
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
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer"
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
curl -OJ "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/download"
```

**Query parameters:** `runtime` (optional) — a runtime id (see
[Runtimes](/docs/runtimes)) hinting which runtime is installing the package, recorded
for install analytics. Purely informational; it doesn't change the response.

Response: `200 OK`, `Content-Type: application/gzip`,
`Content-Disposition: attachment; filename="<owner>-<name>-<version>.tar.gz"`, a
tarball containing every file listed in the package's `manifest.files` (plus
`openagent.yaml` and `README.md`).

- `404 Not Found` — the package doesn't exist.
- `402 Payment Required` — the package is paid and the request is unauthenticated, not
  signed in, or signed in as someone who hasn't purchased it (and doesn't own it).
- `429 Too Many Requests` — more than 60 downloads/minute from the same IP.
- `HEAD` is supported (useful for checking a package exists/is accessible without
  pulling the tarball) and, unlike `GET`, never counts toward the package's download
  counter.

## `GET /api/v1/packages/{owner}/{name}/files/{path}`

Read one raw file from the package, by path (as listed in `files`/`entry`, or
`openagent.yaml`/`README.md`).

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/files/WORKFLOW.md"
```

Response: `200 OK` with the raw file contents. `Content-Type` is inferred from the
file's extension: `.md` → `text/markdown`, `.json` → `application/json`, `.yaml`/
`.yml` → `application/yaml`, anything else → `text/plain`.

- `404 Not Found` — the package or the path doesn't exist in it.
- `402 Payment Required` — the package is paid, the path is anything other than
  `README.md` or `openagent.yaml`, and the caller doesn't own or hasn't purchased the
  package. `README.md` and `openagent.yaml` are always readable for a paid package so
  the storefront can preview them before purchase.
- `429 Too Many Requests` — rate-limited.

## `GET/POST /api/v1/packages/{owner}/{name}/star`

Star/unstar a package. Requires the database (`DATABASE_URL`) to be configured —
starring isn't tracked in seed mode.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/star"
```

```ts
// GET — 200 OK
{ stars: number; starred: boolean } // `starred` reflects the current session; false if signed out

// POST — 200 OK, toggles the current user's star and returns the same shape as GET
{ stars: number; starred: boolean }

// 401 Unauthorized — POST without a signed-in session
// 503 Service Unavailable — DATABASE_URL isn't configured on this deployment
// 429 Too Many Requests — rate-limited
```

## `GET /api/v1/search`

Full-text search across name, title, summary, tags, and owner — the same matching and
ranking behavior as `q` on [`/api/v1/packages`](#get-apiv1packages), scoped to a
smaller, search-focused response.

```bash
curl "https://openagents-nu.vercel.app/api/v1/search?q=code+review"
```

```ts
// 200 OK — same item shape as /api/v1/packages
{
  items: PackageSummary[];
  total: number;
}

// 400 Bad Request — missing or empty q
{ error: "q is required" }
```

`q` is required. `limit` is optional, defaults to `10`, max `50`. The example above
(`q=code+review`) returns `openagents/pr-reviewer` — its tags include `code-review`,
and the tokenized/hyphen-aware matching described above matches both words against it.

## `GET/POST /api/auth/[...nextauth]`

Auth.js sign-in, callback, and session endpoints, with GitHub and Google as providers.
Each provider is independently gated on its own env vars
(`AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`, `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`) plus a
shared `AUTH_SECRET` — see [Self-Hosting](/docs/self-hosting). Without any provider
configured, the `/signin` page shows a "not configured" state rather than erroring; the
app never crashes for missing auth env vars.

## `POST /api/checkout`

Creates a Stripe Checkout session for a paid package purchase.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/checkout" \
  -H "Content-Type: application/json" \
  -d '{"owner": "someone", "name": "their-paid-package"}'
```

```ts
// 200 OK
{ url: string } // redirect the buyer here to complete checkout

// 400 Bad Request — the purchase can't proceed
{ error: string } // "package is free", "subscriptions are not available yet",
                   // "you already own this package", or "you can't buy your own package"

// 401 Unauthorized — no session
// 503 Service Unavailable — when STRIPE_SECRET_KEY isn't configured on this deployment
{ error: "payments are not enabled on this deployment" }
```

On completion, Stripe redirects the buyer to the package page with
`?checkout=success&session_id={CHECKOUT_SESSION_ID}` — the session id lets the success
page verify the purchase server-side rather than trusting the query string alone.

## `POST /api/webhooks/stripe`

Stripe webhook receiver, verified against `STRIPE_WEBHOOK_SECRET`. Called by Stripe,
not by clients directly. Handles:

- `checkout.session.completed` — records the purchase and triggers the Connect
  transfer (minus the platform fee; see [Publishing](/docs/publishing)).
- `checkout.session.async_payment_succeeded` / `checkout.session.async_payment_failed`
  — delayed-payment methods that don't settle synchronously with Checkout.
- `charge.refunded` — revokes access for the refunded purchase.
- `charge.dispute.created` / `charge.dispute.closed` — flags/unflags a purchase under
  dispute.
- The three Stripe Accounts v2 events for a connected seller's recipient
  configuration (capability status, configuration, and requirements updates) — flips
  `users.stripeOnboarded` via `getConnectedAccountStatus`.
- `account.updated` — legacy v1 snapshot event, kept as a harmless fallback; ignored
  for v2 accounts.

```ts
// 503 Service Unavailable — when Stripe isn't configured on this deployment
{ error: "payments are not enabled on this deployment" }
```

## `POST /api/v1/publish`

Submit a package (files + optional changelog) for publishing. Requires an
authenticated session; a paid package additionally requires a connected Stripe
account. Free packages can also go through a pull request instead (see
[Publishing](/docs/publishing)) — this endpoint is the programmatic path for both, and
what the hosted `/publish` form calls. CORS-enabled.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/publish" \
  -H "Content-Type: application/json" \
  -H "Cookie: <session cookie>" \
  -d '{
        "files": [
          { "path": "openagent.yaml", "content": "schema: 1\nname: my-package\n..." },
          { "path": "README.md", "content": "# My Package\n..." }
        ],
        "changelog": "Initial release."
      }'
```

`files` must include `openagent.yaml` and `README.md`. `changelog` is optional
free text (or omit it and put the same content in the first section of
`CHANGELOG.md` among `files` — see [Publishing](/docs/publishing)).

```ts
// 201 Created
{ id: "me/my-package", version: "1.0.0", url: "/p/me/my-package" }

// 400 Bad Request — validation failed
{ error: string, issues: string[] }
```

`400` covers: manifest validation errors (same checks as `openagents validate`), the
manifest's `owner` not matching the authenticated user's handle,
`pricing.model: subscription` (not accepted — see [Package Format](/docs/package-format)),
`pricing.currency` not a 3-letter code, the new `version` not strictly greater than the
package's current published version, and file limits — at most 200 files, 512 KB per
file, 2 MB total, no binary files.

```ts
// 401 Unauthorized — no session
// 403 Forbidden — owner is a reserved name (see Publishing)
{ error: "..." }

// 409 Conflict — this exact version is already published
{ error: "version 1.0.0 is already published" }

// 503 Service Unavailable — DATABASE_URL isn't configured on this deployment
{ error: "publishing requires a database" }
```

The CLI's `openagents publish` currently just prints this endpoint and the `/publish`
URL rather than calling it directly — see [CLI Reference](/docs/cli).

## Error shape

Non-2xx responses across all endpoints return:

```ts
{ error: string; issues?: string[] }
```

with an appropriate HTTP status (`400`, `401`, `402`, `403`, `404`, `409`, `429`,
`503`). `issues` is present only alongside validation failures (currently just
`POST /api/v1/publish`) and lists each individual problem found.

Two exceptions don't carry a JSON body: a `405 Method Not Allowed` for a
disallowed method returns an empty body, and Vercel's own `413 Payload Too Large`
(platform-level request size limit, hit before the route handler ever runs) also
returns a plain, non-JSON response.
