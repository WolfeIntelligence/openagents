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

The full contract is also published as an OpenAPI 3.1 document — see
[OpenAPI](#openapi) at the bottom of this page.

## Authentication

Reads are unauthenticated. Writes accept either a signed-in browser session (the
`/signin` cookie) or a **personal access token**:

```
Authorization: Bearer oa_<40 hex characters>
```

Create one at [`/settings/tokens`](/settings/tokens) or via
[`POST /api/v1/tokens`](#post-apiv1tokens) (session only — a token can't mint another
token). Each token carries a subset of scopes:

| Scope | Grants |
|---|---|
| `read` | Anything a `GET` already allows unauthenticated, plus reading your own reviews/tokens/profile. |
| `publish` | `POST /api/v1/publish`, `POST /api/v1/publish/import`, and `POST /api/v1/packages/{owner}/{name}/status`. |
| `star` | `POST /api/v1/packages/{owner}/{name}/star`. |
| `download` | Downloading a **paid** package you've purchased or own — free downloads never require a scope. |

A session is unrestricted (equivalent to holding every scope). A token missing the
scope a route requires gets `403 Forbidden`, not `401` — the token is valid, it's just
not allowed to do this. The CLI's `openagents login` stores a token at
`~/.config/openagents/config.json` (`%APPDATA%\openagents\config.json` on Windows); see
[CLI Reference](/docs/cli).

## `GET /api/v1/packages`

List/filter packages — the same query parameters as [`/explore`](/explore).

**Query parameters** (all optional): `q` (text search), `kind`
(`workflow`\|`harness`\|`rules`\|`skill`), `runtime` (a runtime id), `price`
(`free`\|`paid`), `tag`, `owner`, `sort`
(`downloads`\|`stars`\|`updated`\|`name`\|`trending`), `limit` (default `24`, max
`100`), `offset`, `facets` (set to `1` to include the `facets` field below).

`q` is tokenized against Postgres full-text search when the database is enabled
(falling back to the same substring/hyphen-aware matching as seed mode otherwise),
ranked by relevance. A `q` with no close matches gets typo-corrected before matching —
when that happens, the response includes `correctedQuery` so a client can show
"Showing results for X" the way a search engine would. `sort=trending` ranks by unique
downloads over the trailing 7 days rather than lifetime totals — good for surfacing
what's currently popular versus what's simply old. Only pending/unlisted packages are
excluded from every list/search result; deprecated packages are still listed (with
their `deprecation` info — see below — so a UI can show a warning).

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
    stats: { downloads: number; stars: number; ratingAverage: number | null; ratingCount: number };
    featured: boolean;
    source: "seed" | "db";
    status: "pending" | "live" | "unlisted" | "deprecated";
    updatedAt: string; // ISO date
  }>;
  total: number;
  correctedQuery?: string;  // present when `q` was typo-corrected
  facets?: {                // present only when `?facets=1`
    kind: Record<string, number>;
    runtime: Record<string, number>;
    tag: Record<string, number>;
    price: Record<string, number>;
  };
}
```

## `GET /api/v1/tags`

Every tag currently in use, with how many (listed, non-pending/unlisted) packages
carry it — powers [`/tags`](/tags) and tag-based facet counts.

```bash
curl "https://openagents-nu.vercel.app/api/v1/tags"
```

```ts
// 200 OK
{ tags: Array<{ tag: string; count: number }> }
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
  latestVersion: string;
  status: "pending" | "live" | "unlisted" | "deprecated";
  deprecation?: { message?: string; replacementId?: string }; // only when status === "deprecated"
  stats: { downloads: number; stars: number; ratingAverage: number | null; ratingCount: number };
  featured: boolean;
  source: "seed" | "db";
  createdAt: string;
  updatedAt: string;
}
// 404 Not Found if owner/name doesn't exist, OR the caller isn't the owner/admin
// of a package whose status is "pending" (pending packages 404 for everyone else)
```

A `pending` package (only reachable when `REQUIRE_REVIEW=1`) 404s for anyone but its
owner or an admin, exactly like a package that doesn't exist — this is deliberate:
it shouldn't be distinguishable from "no such package" to an outside caller. An
`unlisted` package is the opposite: fully readable/installable by anyone who has its
`owner/name` or a direct link, just excluded from listings and search (see
[Publishing](/docs/publishing) for the full lifecycle). A `deprecated` package is
listed normally but carries `deprecation`, which the site renders as a banner and the
CLI surfaces as a warning at install time.

## `GET /api/v1/packages/{owner}/{name}/versions`

List every published version, oldest first.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/versions"
```

```ts
// 200 OK
{ versions: Array<{ version: string; publishedAt: string; changelog?: string }> }
// 404 Not Found
```

## `GET /api/v1/packages/{owner}/{name}/versions/{version}`

Fetch the package as it looked at a specific published version — same shape as
[`GET /api/v1/packages/{owner}/{name}`](#get-apiv1packagesownername), with `manifest`
and `readme` from that version specifically rather than the latest one.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/versions/1.1.0"
```

- `404 Not Found` — the package doesn't exist, or that exact version was never
  published.

## `GET /api/v1/packages/{owner}/{name}/versions/{version}/download`

Download the tarball for one specific version — what a pinned install
(`openagents add owner/name@1.1.0`) fetches, and what
[`GET .../download`](#get-apiv1packagesownernamedownload) (no version) redirects to
conceptually for the current `latestVersion`.

```bash
curl -OJ "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/versions/1.1.0/download"
```

Response: `200 OK`, `Content-Type: application/gzip`, plus two headers every download
route sets (including the latest, unversioned `/download` below):

| Header | Purpose |
|---|---|
| `ETag` | A stable identifier for this exact tarball. Send it back as `If-None-Match` on a later request to get `304 Not Modified` with no body instead of re-downloading. |
| `X-Checksum-Sha256` | SHA-256 of the tarball bytes. The CLI records this as `integrity` in `.openagents/installed.json` (lockfile v2) and re-checks it after extraction — see [CLI Reference](/docs/cli). |

Free packages are additionally served with an **immutable** `Cache-Control`
(`public, max-age=31536000, immutable`) — a specific version's tarball can never
change once published, so it's safe to cache forever; a paid package's tarball stays
`private, no-store` regardless of version, since access depends on who's asking.

`HEAD` is supported (never counts as a download). Errors match the unversioned
download route below (`402`, `404`, `429`).

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
`Content-Disposition: attachment; filename="<owner>-<name>-<version>.tar.gz"`, plus
`ETag` and `X-Checksum-Sha256` (see the versioned download route above for what these
mean and how the CLI uses them). The tarball contains every file listed in the
package's `manifest.files` (plus `openagent.yaml` and `README.md`), for the package's
current `latestVersion`.

- `304 Not Modified` — `If-None-Match` matched the current `ETag`.
- `404 Not Found` — the package doesn't exist.
- `402 Payment Required` — the package is paid and the request is unauthenticated, not
  signed in, or signed in as someone who hasn't purchased it (and doesn't own it). A
  token needs the `download` scope in this case — see [Authentication](#authentication).
- `429 Too Many Requests` — more than 60 downloads/minute from the same IP.
- `HEAD` is supported (useful for checking a package exists/is accessible without
  pulling the tarball) and, unlike `GET`, never counts toward the package's download
  counter.

## `GET /api/v1/packages/{owner}/{name}/files/{path}`

Read one raw file from the package, by path (as listed in `files`/`entry`, or
`openagent.yaml`/`README.md`). Add `?version=1.1.0` to read the file as of a specific
published version instead of `latestVersion`.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/files/WORKFLOW.md"
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/files/WORKFLOW.md?version=1.1.0"
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
starring isn't tracked in seed mode. `POST` accepts a session or a token with the
`star` scope.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/star"
```

```ts
// GET — 200 OK
{ stars: number; starred: boolean } // `starred` reflects the current session; false if signed out

// POST — 200 OK, toggles the current user's star and returns the same shape as GET
{ stars: number; starred: boolean }

// 401 Unauthorized — POST without a signed-in session or token
// 403 Forbidden — token present but missing the `star` scope
// 503 Service Unavailable — DATABASE_URL isn't configured on this deployment
// 429 Too Many Requests — rate-limited
```

## `GET/PUT/DELETE /api/v1/packages/{owner}/{name}/reviews`

Star ratings with an optional written review. One review per user per package;
`PUT` upserts. Package owners can't review their own package.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/reviews"

curl -X PUT "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/reviews" \
  -H "Authorization: Bearer oa_..." -H "Content-Type: application/json" \
  -d '{"rating": 5, "body": "Caught a real bug on the first PR I ran it against."}'
```

```ts
// GET — 200 OK
{
  items: Array<{
    id: string;
    user: { handle: string; name: string | null; image: string | null };
    rating: number;        // 1..5
    body?: string;
    createdAt: string;
    updatedAt: string;
    verifiedPurchase: boolean; // true iff this user has a paid purchase of this package
  }>;
  average: number | null;  // null when count is 0
  count: number;
}

// PUT — 200 OK, the caller's created/updated review
{ rating: 1..5, body?: string, ...same shape as one item above }

// DELETE — 204 No Content

// 400 Bad Request — rating outside 1..5
// 401 Unauthorized — PUT/DELETE without a session or `read`-scoped token
// 403 Forbidden — the caller owns this package
```

A package's `ratingAverage`/`ratingCount` (visible on its summary and detail
responses) are recomputed from this table on every write — they're derived data, not
an independently-incremented counter.

## `POST /api/v1/packages/{owner}/{name}/status`

Change a package's lifecycle status, or delete it. Owner or admin only (admins are
`users.isAdmin` rows, or any handle listed in `ADMIN_HANDLES`).

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/packages/me/my-package/status" \
  -H "Authorization: Bearer oa_..." -H "Content-Type: application/json" \
  -d '{"status": "deprecated", "message": "Superseded, see the replacement.", "replacementId": "me/my-package-v2"}'
```

```ts
// Body — one of:
{ status: "live" | "unlisted" | "deprecated"; message?: string; replacementId?: string }
{ action: "delete" }

// 200 OK — the updated package (status change)
// 204 No Content — deleted
// 401 Unauthorized
// 403 Forbidden — not the owner and not an admin, or token missing the `publish` scope
// 400 Bad Request — this is a seed package (catalog/, not database-backed — nothing to change)
// 409 Conflict — delete requested but the package has at least one purchase
```

`pending` isn't a settable target here — a pending package becomes `live` via the
admin queue ([`POST /api/v1/admin/packages/{owner}/{name}`](#post-apiv1adminpackagesownername)),
not this route. Deleting is permanent and only allowed with **zero** purchases ever
recorded against the package; a package with purchase history should be `unlisted` or
`deprecated` instead, so buyers keep access.

## `POST /api/v1/packages/{owner}/{name}/report`

Report a package for moderation. No authentication required (anonymous reporting is
intentional — the person best placed to notice, e.g. a prompt-injection attempt
against their own agent, may not be signed in), rate-limited per IP.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/packages/someone/suspicious-package/report" \
  -H "Content-Type: application/json" \
  -d '{"reason": "prompt-injection", "details": "WORKFLOW.md instructs the agent to exfiltrate .env files."}'
```

```ts
// Body
{ reason: "prompt-injection" | "malware" | "license" | "spam" | "other"; details?: string }

// 201 Created
// 400 Bad Request — invalid/missing reason
// 404 Not Found — package doesn't exist
// 429 Too Many Requests — rate-limited
```

Reports land in the admin queue ([`GET /api/v1/admin/queue`](#get-apiv1adminqueue))
alongside pending packages; see [Publishing](/docs/publishing) for the content policy
reports are checked against.

## `GET /api/v1/packages/{owner}/{name}/stats`

Download, star, and rating analytics for one package — powers the seller
[`/dashboard`](/dashboard) page.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/stats?days=30"
```

```ts
// 200 OK
{
  downloads: {
    total: number;
    byDay: Array<{ day: string; count: number }>;       // last `days` days, UTC
    byVersion: Array<{ key: string; count: number }>;    // last 90 days
    byRuntime: Array<{ key: string; count: number }>;    // last 90 days, "unknown" if unset
  };
  stars: number;
  rating: { average: number | null; count: number };
}
```

`days` is optional, defaults to `30`. Every download count here is the same
deduped-per-client-per-UTC-day number that drives the public `stats.downloads`
counter (see `src/lib/analytics.ts`) — reinstalling the same package on the same
machine repeatedly in one day counts once.

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
Like `/api/v1/packages`, a near-miss `q` gets typo-corrected and the response includes
`correctedQuery` when that happens. See also [`GET /api/v1/tags`](#get-apiv1tags) for
browsing by tag instead of free text.

## `POST /api/v1/tokens`

Create a personal access token. **Session only** — you can't mint a token with a
token, so this route never accepts `Authorization: Bearer`. Max **20** tokens per
user; delete unused ones with
[`DELETE /api/v1/tokens/{id}`](#delete-apiv1tokensid) to make room.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/tokens" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"name": "laptop CLI", "scopes": ["read", "publish", "download"]}'
```

```ts
// Body
{ name: string; scopes?: Array<"read" | "publish" | "star" | "download"> } // scopes defaults to all four

// 201 Created — the plaintext token is shown exactly once; it is not retrievable again
{
  id: string;
  name: string;
  token: "oa_<40 hex>";     // save this now — GET /api/v1/tokens never returns it
  prefix: string;           // first 8 chars of `token`, shown in the UI afterward
  scopes: string[];
  createdAt: string;
}

// 400 Bad Request — at the 20-token limit, or an unrecognized scope
// 401 Unauthorized — no session
```

## `GET /api/v1/tokens`

List the current user's tokens (never includes the plaintext).

```bash
curl "https://openagents-nu.vercel.app/api/v1/tokens" -H "Cookie: <session cookie>"
```

```ts
// 200 OK
{ tokens: Array<{ id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; createdAt: string; revokedAt: string | null }> }
```

## `DELETE /api/v1/tokens/{id}`

Revoke a token. Session only, and only your own tokens.

```bash
curl -X DELETE "https://openagents-nu.vercel.app/api/v1/tokens/<id>" -H "Cookie: <session cookie>"
```

`204 No Content` on success; `404 Not Found` if `id` doesn't exist or belongs to
someone else (never `403`, so token ids can't be probed).

## `GET /api/v1/me`

The current requester — session or token — and, for a token, which scopes it carries.
Also what [`openagents whoami`](/docs/cli) calls.

```bash
curl "https://openagents-nu.vercel.app/api/v1/me" -H "Authorization: Bearer oa_..."
```

```ts
// 200 OK
{ id: string; handle?: string; name?: string | null; image?: string | null; via: "session" | "token"; scopes: string[] }

// 401 Unauthorized — no session and no valid token
```

## `GET /api/v1/users/{handle}`

Public profile for a creator: bio, website, and their live packages.

```bash
curl "https://openagents-nu.vercel.app/api/v1/users/openagents"
```

```ts
// 200 OK
{ handle: string; name?: string | null; image?: string | null; bio?: string | null; website?: string | null; packages: PackageSummary[] }

// 404 Not Found — no user with this handle
```

## `GET/PUT /api/v1/profile`

Read or update the signed-in user's own profile.

```bash
curl -X PUT "https://openagents-nu.vercel.app/api/v1/profile" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"bio": "I build workflows.", "website": "https://example.com"}'
```

```ts
// Body (all optional)
{ name?: string; bio?: string; website?: string; handle?: string }

// 200 OK — the updated profile, same shape as GET /api/v1/users/{handle}
// 400 Bad Request — `handle` was included but the user owns one or more packages
// 401 Unauthorized — no session
```

`handle` can only be changed while the user owns **zero** packages — once you've
published, your handle is load-bearing for every `owner/name` id and install command
that references you, so it locks.

## `GET /api/v1/admin/queue`

Pending packages awaiting approval, plus open reports. Admin only.

```bash
curl "https://openagents-nu.vercel.app/api/v1/admin/queue" -H "Cookie: <session cookie>"
```

```ts
// 200 OK
{ pending: PackageSummary[]; reports: Array<{ id: string; owner: string; name: string; reason: string; details?: string; status: string; createdAt: string }> }

// 401 Unauthorized — no session
// 403 Forbidden — signed in, but not an admin
```

## `POST /api/v1/admin/packages/{owner}/{name}`

Approve or reject a pending package, or toggle `featured`. Admin only.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/admin/packages/someone/new-package" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"action": "approve"}'
```

```ts
// Body
{ action: "approve" | "reject" } | { featured: boolean }

// 200 OK — the updated package
// 401 Unauthorized / 403 Forbidden — same as the queue route above
```

## `POST /api/v1/admin/reports/{id}`

Resolve or dismiss a report. Admin only.

```ts
// Body
{ status: "resolved" | "dismissed" }

// 200 OK
// 401 Unauthorized / 403 Forbidden — same as the queue route above
```

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

Submit a package (files + optional changelog) for publishing. Accepts a session or a
token with the `publish` scope; a paid package additionally requires a connected
Stripe account. Free packages can also go through a pull request instead (see
[Publishing](/docs/publishing)) — this endpoint is the programmatic path for both, and
what the hosted `/publish` form and `openagents publish` call. CORS-enabled.

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
{ id: "me/my-package", version: "1.0.0", url: "/p/me/my-package", status: "live" | "pending" }

// 400 Bad Request — validation failed
{ error: string, issues: string[] }
```

`status` is `"pending"` instead of `"live"` when this deployment has `REQUIRE_REVIEW=1`
set **and** this is a brand-new package (its first-ever version) — a pending package is
invisible to everyone but its owner and admins until approved from `/admin` (see
[Publishing](/docs/publishing)). Publishing a new version of an already-`live` package
always comes back `"live"` immediately, regardless of `REQUIRE_REVIEW` — the review
gate is about letting a new, unvetted package onto the platform, not re-reviewing
every update from an already-trusted publisher.

`400` covers: manifest validation errors (same checks as `openagents validate`), the
manifest's `owner` not matching the authenticated user's handle,
`pricing.model: subscription` (not accepted — see [Package Format](/docs/package-format)),
`pricing.currency` not a 3-letter code, the new `version` not strictly greater than the
package's current published version, and file limits — at most 200 files, 512 KB per
file, 2 MB total, no binary files.

```ts
// 401 Unauthorized — no session or token
// 403 Forbidden — owner is a reserved name (see Publishing), or a token is missing the `publish` scope
{ error: "..." }

// 409 Conflict — this exact version is already published
{ error: "version 1.0.0 is already published" }

// 503 Service Unavailable — DATABASE_URL isn't configured on this deployment
{ error: "publishing requires a database" }
```

`openagents publish [dir]` (CLI 0.3.0) calls this endpoint directly using the token
from `openagents login` — see [CLI Reference](/docs/cli) for `--dry-run`,
`--changelog`, and `--from-github`.

## `POST /api/v1/publish/import`

Publish straight from a public GitHub repository — no local checkout needed. Same
validation, file limits, and `REQUIRE_REVIEW` behavior as
[`POST /api/v1/publish`](#post-apiv1publish); this route just sources `files` from
GitHub instead of the request body. What `openagents publish --from-github <url>` and
the "Import from GitHub" option on `/publish` both call.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/publish/import" \
  -H "Authorization: Bearer oa_..." -H "Content-Type: application/json" \
  -d '{"repo": "github.com/me/my-package/tree/main/packages/reviewer", "changelog": "Initial release."}'
```

```ts
// Body
{
  repo: string;        // "github.com/{owner}/{repo}", optionally "/tree/{ref}/{subdir}"
  ref?: string;        // overrides a ref already embedded in `repo`
  subdir?: string;     // overrides a subdir already embedded in `repo`
  changelog?: string;
}

// 201 Created — same shape as POST /api/v1/publish
{ id: string, version: string, url: string, status: "live" | "pending" }

// 400 Bad Request — repo/ref/subdir couldn't be resolved (private repo, missing
// openagent.yaml at that path, branch doesn't exist), or the fetched manifest fails
// the same validation as POST /api/v1/publish
// 401 Unauthorized — no session or token
```

`ref` defaults to the repository's default branch; `subdir` defaults to the repo root.
Only public repositories are supported — there's no GitHub App/OAuth flow for private
repo access.

## Error shape

Non-2xx responses across all endpoints return:

```ts
{ error: string; issues?: string[] }
```

with an appropriate HTTP status (`400`, `401`, `402`, `403`, `404`, `409`, `429`,
`503`). `issues` is present only alongside validation failures (currently just
`POST /api/v1/publish` and `POST /api/v1/publish/import`) and lists each individual
problem found.

`401` vs. `403`, consistently across every route: `401` means "you're not
authenticated at all" (no session, no valid bearer token); `403` means "you're
authenticated, but not allowed to do this" — a token missing the required scope, a
non-owner/non-admin hitting an owner/admin-only route, or a reserved owner name.

Two exceptions don't carry a JSON body: a `405 Method Not Allowed` for a
disallowed method returns an empty body, and Vercel's own `413 Payload Too Large`
(platform-level request size limit, hit before the route handler ever runs) also
returns a plain, non-JSON response.

## Rate limits

Rate limiting is in-memory and per-serverless-instance (best-effort — see
`src/lib/ratelimit.ts`), not a hard, globally-exact guarantee. A `429` response always
carries a `Retry-After` header (seconds).

| Route | Limit |
|---|---|
| `.../download`, `.../versions/{version}/download` | 60 requests/minute/IP |
| `.../files/{path}` | 120 requests/minute/IP |
| `.../star` (POST) | 30 requests/minute/IP |
| `.../report` | Anonymous-friendly but tight — see `src/lib/ratelimit.ts` for the exact number once this route lands; it exists specifically to blunt spam against an unauthenticated endpoint. |

## OpenAPI

The full contract — every route on this page, in OpenAPI 3.1 — is generated
alongside this document rather than by hand, so it can't silently drift from what's
actually implemented:

- Static file: [`/openapi.json`](/openapi.json)
- Same document, served under the API: `GET /api/v1/openapi`

`scripts/check-openapi.ts` (`npm run` it via `npx tsx scripts/check-openapi.ts`, and
in CI) walks every `route.ts` under `src/app/api` and fails the build if a route
exists with no corresponding `paths` entry in `public/openapi.json` — the reverse
direction (a documented path with no route file yet) is expected while a batch of
features is mid-rollout and is not flagged.
