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
| `read` | Anything a `GET` already allows unauthenticated, plus reading your own tokens/profile. |
| `publish` | `POST /api/v1/publish`, `POST /api/v1/publish/import`, and `POST /api/v1/packages/{owner}/{name}/status`. |
| `star` | `POST /api/v1/packages/{owner}/{name}/star`. |
| `download` | Downloading a **paid** package you've purchased or own — free downloads never require a scope. |
| `review` | `PUT/DELETE /api/v1/packages/{owner}/{name}/reviews` — writing or removing your own star rating/review. |

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
    ownerType: "user" | "org"; // whether `owner` names a user handle or an organization handle
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
  ownerType: "user" | "org";       // whether `owner` names a user handle or an organization handle
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
  advisories: Advisory[];          // open (non-withdrawn) advisories, newest first — see Trust & Safety
  verifiedSource: { repo: string; ref: string; lastSyncedAt: string } | null; // set once a linked GitHub source (see GitHub auto-sync) has synced at least once
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

## `GET /api/v1/packages/{owner}/{name}/versions/{version}/diff?against={w}`

Compare two published versions file-by-file — what powers the compare page
([`/p/{owner}/{name}/compare`](#compare-page-and-changelog) below).

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/versions/1.2.0/diff?against=1.1.0"
```

```ts
// 200 OK
{
  from: string;   // `against`
  to: string;     // the {version} path segment
  files: Array<{
    path: string;
    status: "added" | "removed" | "modified" | "unchanged";
    hunks?: Array<{ header: string; lines: Array<{ type: "context" | "add" | "del"; text: string }> }>;
    // omitted entirely for a paid package's non-preview file the caller can't read (see 402 below)
  }>;
  summary: { filesChanged: number; additions: number; deletions: number };
  truncated: boolean; // true if one or more files were too large to diff and were skipped
}

// 400 Bad Request — `against` doesn't name a published version of this package
// 402 Payment Required — the package is paid, `against` or {version} touches a
// file other than README.md/openagent.yaml, and the caller hasn't purchased/doesn't
// own it — same rule as the raw file route
// 404 Not Found — the package, {version}, or `against` doesn't exist
```

`against` defaults to the version immediately before `{version}` in publish order
when omitted. Binary files are reported with `status` only (no `hunks`) since a
byte-level diff isn't meaningful to render.

### Compare page and changelog

[`/p/{owner}/{name}/compare?from=&to=&view=split|unified`](/p) renders the diff
above as a page — `view` toggles a side-by-side vs. unified rendering, both driven
by the same `GET .../diff` response. Site-wide, [`/changelog`](/changelog) (optionally
`?owner=` to scope to one creator) lists every version published across the catalog,
newest first, each entry showing its `changelog` text; [`/changelog.xml`](/changelog.xml)
is the same feed as RSS/Atom, separate from `/feed.xml` (see
[Sharing & SEO](#sharing--seo) below — that feed is new/updated *packages*, not
every version).

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

**Query parameters** (GET, all optional): `sort` (`newest` (default) \|
`rating` \| `helpful`), `limit` (default `20`, max `100`), `offset`.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/reviews?sort=rating&limit=10"

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
    helpfulCount: number;
  }>;
  total: number;
  average: number | null;  // null when count is 0
  count: number;
  histogram: { 1: number; 2: number; 3: number; 4: number; 5: number }; // count of reviews at each star rating
}

// PUT — 200 OK, the caller's created/updated review
{ rating: 1..5, body?: string, ...same shape as one item above }

// DELETE — 204 No Content

// 400 Bad Request — rating outside 1..5
// 401 Unauthorized — PUT/DELETE without a session or a token carrying the `review` scope
// 403 Forbidden — the caller owns this package
```

`sort=helpful` orders by `helpfulCount` descending (ties broken newest-first);
`rating` orders highest-star-first. The rating histogram is always the full
per-package distribution, independent of `sort`/`limit`/`offset` — a client renders
it once alongside a paginated list.

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

## `POST /api/v1/packages/{owner}/{name}/transfer`

Transfer a package to a different owner — a user handle, or an organization the
caller is an `owner`/`admin` member of. Current owner or admin only.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/packages/me/my-package/transfer" \
  -H "Authorization: Bearer oa_..." -H "Content-Type: application/json" \
  -d '{"to": "my-org"}'
```

```ts
// Body
{ to: string } // a user or organization handle

// 200 OK — the updated package, with `owner`/`ownerType` reflecting the new owner
// 400 Bad Request — `to` doesn't exist, or names an organization the caller isn't
//                    an owner/admin member of
// 401 Unauthorized / 403 Forbidden — not the current owner/admin, or token missing `publish`
// 404 Not Found — package doesn't exist
```

Transferring to an organization requires the caller hold `owner` or `admin`
membership there (see [Organizations](#organizations) below) — publishing and
transferring under an org are gated the same way. Existing purchases, reviews, and
stats move with the package; nothing about `owner/name` history is rewritten, so
old install commands referencing the previous owner will 404 once the transfer
completes (the same as any other owner-handle change).

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
that references you, so it locks. Both the public (`GET /api/v1/users/{handle}`) and
own-profile shapes also carry `joinedAt` (the account's creation date) alongside
`packages`.

## Account

### `GET /api/v1/account/export`

Download everything tied to the signed-in account as a single JSON file: profile,
owned packages and their versions, purchases (including subscriptions), reviews
written, tokens (metadata only — never plaintext), stars, and collections. Session
only — this is a personal-data export, not something a token should be able to
trigger on someone's behalf.

```bash
curl "https://openagents-nu.vercel.app/api/v1/account/export" -H "Cookie: <session cookie>" -OJ
```

Response: `200 OK`, `Content-Type: application/json`,
`Content-Disposition: attachment; filename="openagents-export-<handle>-<date>.json"`.

- `401 Unauthorized` — no session.

### `DELETE /api/v1/account`

Permanently delete the signed-in account. Session only. To make an accidental call
harder, the body must echo the caller's own handle back:

```bash
curl -X DELETE "https://openagents-nu.vercel.app/api/v1/account" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"confirm": "zach"}'
```

```ts
// Body
{ confirm: string } // must exactly equal the caller's own handle

// 204 No Content
// 400 Bad Request — `confirm` doesn't match the handle
// 401 Unauthorized — no session
// 409 Conflict — the account owns a package with at least one sale, or holds an
//                 active subscription (as buyer or as a seller with active
//                 subscribers) — retire or transfer those first (see Publishing)
```

This mirrors the package-deletion rule (`POST /api/v1/packages/{owner}/{name}/status`
with `{"action": "delete"}`): once money has moved, the row sticks around so buyers
and sellers keep their history.

## Organizations

A shared publisher identity: a `handle` (in the same namespace as user handles —
`packages.owner` is a handle either way, `packages.ownerType` says whether it's a
user or an org) with its own display name, bio, and website, owned and managed by
one or more members. See [Publishing](/docs/publishing#organizations) for the
membership/roles model.

### `POST /api/v1/orgs`

Create an organization. The creator becomes its first `owner` member. Session or a
token with the `publish` scope.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/orgs" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"handle": "acme-agents", "displayName": "Acme Agents", "bio": "We build PR review workflows."}'
```

```ts
// Body
{ handle: string; displayName: string; bio?: string; website?: string }

// 201 Created
{ handle: string; displayName: string; bio?: string; website?: string; avatarUrl?: string; createdAt: string }

// 400 Bad Request — `handle` fails the same format check as a user handle (`^[a-z0-9-]{2,64}$`), or is reserved
// 401 Unauthorized
// 409 Conflict — `handle` is already taken (by a user or another organization — they share one namespace)
```

### `GET /api/v1/orgs?member=me`

List organizations. With no query, lists public org profiles (paginated,
`limit`/`offset`); `?member=me` (session/token required) lists only organizations
the caller belongs to, including their role.

```bash
curl "https://openagents-nu.vercel.app/api/v1/orgs?member=me" -H "Cookie: <session cookie>"
```

```ts
// 200 OK
{
  items: Array<{
    handle: string; displayName: string; bio?: string; website?: string; avatarUrl?: string;
    role?: "owner" | "admin" | "member"; // present only when ?member=me
  }>;
  total: number;
}

// 401 Unauthorized — `?member=me` without a session/token
```

### `GET/PATCH/DELETE /api/v1/orgs/{handle}`

Fetch, update, or delete one organization.

```bash
curl -X PATCH "https://openagents-nu.vercel.app/api/v1/orgs/acme-agents" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"bio": "PR review and release-notes workflows."}'
```

```ts
// GET — 200 OK
{ handle: string; displayName: string; bio?: string; website?: string; avatarUrl?: string; createdAt: string; members: Array<{ handle: string; name: string | null; role: "owner" | "admin" | "member" }> }
// 404 Not Found

// PATCH — body: { displayName?: string; bio?: string; website?: string } — owner/admin member only
// 200 OK — the updated organization

// DELETE — owner member only, and only once the org owns zero packages
// 204 No Content
// 409 Conflict — the org still owns one or more packages; transfer or delete those first
```

### `PUT /api/v1/orgs/{handle}/members {handle, role}`

Add a member, or change an existing member's role. Owner/admin member only.

```bash
curl -X PUT "https://openagents-nu.vercel.app/api/v1/orgs/acme-agents/members" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"handle": "zach", "role": "admin"}'
```

```ts
// Body
{ handle: string; role: "owner" | "admin" | "member" }

// 200 OK — the updated membership list, same shape as GET /api/v1/orgs/{handle}'s `members`
// 400 Bad Request — `handle` isn't a known user
// 401 Unauthorized / 403 Forbidden — not an owner/admin member
// 404 Not Found — org doesn't exist
```

### `DELETE /api/v1/orgs/{handle}/members/{userHandle}`

Remove a member (or leave, for your own handle). Owner/admin member only to remove
someone else; any member can remove themself.

```ts
// 204 No Content
// 400 Bad Request — `userHandle` is the org's last remaining owner ("last owner cannot leave" —
//                    promote another member to owner first)
// 401 Unauthorized / 403 Forbidden — not an owner/admin, and not removing self
// 404 Not Found — org doesn't exist, or `userHandle` isn't a member
```

Publishing a package under an organization (`owner` in `openagent.yaml` set to the
org's handle) requires `owner` or `admin` membership at publish time — a plain
`member` can install and use the org's packages and gets paid-download access to
anything the org has purchased, but can't publish or transfer packages on its
behalf. See [`POST /api/v1/packages/{owner}/{name}/transfer`](#post-apiv1packagesownernametransfer)
to move an existing package to/from an org, and `/org/{handle}` / `/settings/orgs`
for the web UI.

## Collections

Curated, ordered lists of packages — a creator's "starter kit," a team's approved
toolset, a themed roundup. A collection belongs to one user and is either public
(shown on `/collections`, `/c/{handle}/{slug}`, the landing page rail, and the
sitemap) or unlisted (readable by direct link only, like an unlisted package).

### `GET /api/v1/collections`

List collections.

**Query parameters** (all optional): `featured` (`1` for editorially-featured
collections only), `owner` (a handle — that user's public collections), `limit`
(default `24`, max `100`), `offset`.

```bash
curl "https://openagents-nu.vercel.app/api/v1/collections?featured=1"
```

```ts
// 200 OK
{
  items: Array<{
    id: string;
    ownerHandle: string;
    slug: string;
    title: string;
    description?: string;
    isPublic: boolean;
    featured: boolean;
    itemCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}
```

### `POST /api/v1/collections`

Create a collection. Session or a token with the `publish` scope.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/collections" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"title": "My favorite review workflows", "isPublic": true}'
```

```ts
// Body
{ title: string; slug?: string; description?: string; isPublic?: boolean }
// slug defaults to a slugified title; isPublic defaults to true

// 201 Created
{ id, ownerHandle, slug, title, description, isPublic, featured: false, itemCount: 0, createdAt, updatedAt }

// 401 Unauthorized
// 403 Forbidden — token missing the `publish` scope
// 409 Conflict — the caller already has a collection with this slug
```

### `GET/PATCH/DELETE /api/v1/collections/{handle}/{slug}`

Fetch, update, or delete one collection, including its items (each with the
package's current `PackageSummary` inlined, so a client doesn't need a second
round-trip per item).

```bash
curl "https://openagents-nu.vercel.app/api/v1/collections/zach/starter-kit"
```

```ts
// GET — 200 OK
{
  id: string; ownerHandle: string; slug: string; title: string; description?: string;
  isPublic: boolean; featured: boolean; createdAt: string; updatedAt: string;
  items: Array<{ owner: string; name: string; note?: string; position: number; addedAt: string; package: PackageSummary }>;
}
// 404 Not Found — doesn't exist, or is unlisted and the caller isn't the owner

// PATCH — same body shape as POST above (all fields optional); owner or admin only
// 200 OK — the updated collection (without items)

// DELETE — owner or admin only
// 204 No Content
```

### `PUT/DELETE /api/v1/collections/{handle}/{slug}/items/{owner}/{name}`

Add (or reorder/annotate) and remove one package from a collection. Owner or admin
only.

```bash
curl -X PUT "https://openagents-nu.vercel.app/api/v1/collections/zach/starter-kit/items/openagents/pr-reviewer" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"note": "Run this first on every PR.", "position": 0}'
```

```ts
// PUT body (owner/name are also in the URL; both accepted for symmetry with other
// routes, but the URL wins if they conflict)
{ owner: string; name: string; note?: string; position?: number }

// 200 OK — the updated item
// 400 Bad Request — package doesn't exist
// 401 Unauthorized / 403 Forbidden — not the collection's owner/admin

// DELETE — 204 No Content
```

A package's own page shows an "Add to collection" action for the signed-in owner's
collections, and `/c/{handle}/{slug}` renders a "copy install-all" command
(`openagents add` for every item in the collection, one per line) so a visitor can
install the whole set in one paste.

### `POST /api/v1/admin/collections/{handle}/{slug}`

Toggle a collection's editorial `featured` flag. Admin only — same admin check as
the rest of `/api/v1/admin/*`.

```ts
// Body
{ featured: boolean }

// 200 OK — the updated collection
// 401 Unauthorized / 403 Forbidden — same as the other admin routes
```

## Badges

### `GET /api/v1/packages/{owner}/{name}/badge`

An embeddable SVG status badge (shields.io-style) for a package's README or a
creator's own site.

**Query parameters:** `type` — one of `version` | `downloads` | `stars` | `rating`,
default `version`.

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/badge?type=downloads"
```

Response: `200 OK`, `Content-Type: image/svg+xml`, cacheable
(`Cache-Control: public, max-age=300`) — short-lived since the underlying numbers
change, but cheap to regenerate.

`/dashboard` shows ready-to-paste Markdown snippets
(`![downloads](.../badge?type=downloads)`) for each of your live packages.

## Sharing & SEO

- **Open Graph images** — `/p/{owner}/{name}/opengraph-image` and
  `/u/{owner}/opengraph-image` are generated on request; link previews on social
  platforms and chat apps need no extra API call, just the page URL.
- **JSON-LD** — every package page (`/p/{owner}/{name}`) embeds a `SoftwareSourceCode`
  structured-data block for search engines.
- **RSS** — [`/feed.xml`](/feed.xml) lists newly published and newly updated packages.
- **Badges** — see [above](#badges).

## GitHub auto-sync

Link a package to a GitHub repository so a new release (or tag push) republishes it
automatically, instead of running `openagents publish` by hand each time.

### `PUT/GET/DELETE /api/v1/packages/{owner}/{name}/source`

Owner or admin only; session or a token with the `publish` scope.

```bash
curl -X PUT "https://openagents-nu.vercel.app/api/v1/packages/me/my-package/source" \
  -H "Authorization: Bearer oa_..." -H "Content-Type: application/json" \
  -d '{"repo": "me/my-package", "subdir": "packages/my-package"}'
```

```ts
// PUT body
{ repo: string; ref?: string; subdir?: string } // ref defaults to the repo's default branch

// PUT — 201 Created (first time) / 200 OK (updating an existing link)
{
  id: string;
  repo: string;
  ref?: string;
  subdir?: string;
  webhookUrl: string;   // "<site>/api/webhooks/github/{id}" — paste into the repo's webhook settings
  secret: string;       // shown exactly once — paste into the same webhook config; never retrievable again
}

// GET — 200 OK, same shape minus `secret`
// DELETE — 204 No Content (unlinks; does not touch anything already published)

// 400 Bad Request — repo/subdir couldn't be resolved
// 401 Unauthorized / 403 Forbidden — not the owner/admin, or token missing `publish`
// 404 Not Found — no source linked (GET/DELETE)
```

### `POST /api/v1/packages/{owner}/{name}/source/sync`

Trigger a sync right now instead of waiting for the next release/tag push — same
validation and `REQUIRE_REVIEW` behavior as
[`POST /api/v1/publish/import`](#post-apiv1publishimport).

```ts
// 201 Created — same shape as POST /api/v1/publish, when a new version was published
// 200 OK — { synced: false, reason: "up to date" } when nothing changed
// 400/401/403 — same as the route above
```

### `POST /api/webhooks/github/{id}`

Receiver for one linked source's GitHub webhook — `release` (`published` action) and
tag-push events. Verified against that source's secret (HMAC over the raw body,
compared against `X-Hub-Signature-256`, the same scheme GitHub itself uses); falls
back to signing against `SOURCE_WEBHOOK_KEY` (or `AUTH_SECRET` if that isn't set —
see [Self-Hosting](/docs/self-hosting)) for the outer request when a deployment wants
one shared verification key across all sources. Imports the manifest at the
released/tagged ref and publishes a new version exactly when its `version` is
strictly greater than the currently published one — a re-delivered or out-of-order
webhook is a safe no-op, not a duplicate publish. Not intended for direct client
calls; `/settings/sources` shows each linked package's last sync result.

```ts
// 200 OK — { synced: boolean, version?: string }
// 401 Unauthorized — signature didn't verify
// 404 Not Found — unknown source id
```

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

Creates a Stripe Checkout session for a paid package purchase — one-time or
subscription, depending on the package's `pricing.model`.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/checkout" \
  -H "Content-Type: application/json" \
  -d '{"owner": "someone", "name": "their-paid-package"}'
```

```ts
// 200 OK
{ url: string } // redirect the buyer here to complete checkout

// 400 Bad Request — the purchase can't proceed
{ error: string } // "package is free", "you already own this package",
                   // "you already have an active subscription to this package",
                   // or "you can't buy your own package"

// 401 Unauthorized — no session
// 429 Too Many Requests — rate-limited
// 503 Service Unavailable — when STRIPE_SECRET_KEY isn't configured on this deployment
{ error: "payments are not enabled on this deployment" }
```

For `pricing.model: one-time`, this is a normal single-charge Checkout session. For
`pricing.model: subscription`, Checkout runs in **subscription mode** instead:

- The buyer gets (or reuses, if they've bought a subscription before) a Stripe
  **Customer**, recorded on `users.stripeCustomerId`.
- The platform fee (`PLATFORM_FEE_BPS`) is applied via `application_fee_percent` on
  the subscription itself, so it's taken on **every renewal**, not just the first
  invoice — the remainder is transferred to the seller's connected Stripe account,
  same as a one-time sale.
- The resulting `purchases` row carries `stripeSubscriptionId` and an `expiresAt`
  set to the current billing period's end; access is checked against `expiresAt`
  everywhere a paid download/file-read is gated, exactly like an unlimited one-time
  purchase except it has an expiry that keeps rolling forward on each successful
  renewal (see the webhook events below) instead of being open-ended.

On completion, Stripe redirects the buyer to the package page with
`?checkout=success&session_id={CHECKOUT_SESSION_ID}` — the session id lets the success
page verify the purchase server-side rather than trusting the query string alone.

## `POST /api/billing/portal`

Creates a Stripe **billing portal** session so a subscriber can update their payment
method or cancel a subscription without emailing support. Session only.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/billing/portal" -H "Cookie: <session cookie>"
```

```ts
// 200 OK
{ url: string } // redirect the buyer here

// 401 Unauthorized — no session
// 400 Bad Request — the caller has no Stripe Customer yet (never subscribed to anything)
// 503 Service Unavailable — payments not enabled on this deployment
```

[`/purchases`](/purchases) shows each subscription's renewal or end date next to a
**Manage** button that calls this route.

## `POST /api/webhooks/stripe`

Stripe webhook receiver, verified against `STRIPE_WEBHOOK_SECRET`. Called by Stripe,
not by clients directly. Handles:

- `checkout.session.completed` — records the purchase (one-time or the first period
  of a subscription) and triggers the Connect transfer (minus the platform fee; see
  [Publishing](/docs/publishing)).
- `checkout.session.async_payment_succeeded` / `checkout.session.async_payment_failed`
  — delayed-payment methods that don't settle synchronously with Checkout.
- `charge.refunded` — revokes access for the refunded purchase.
- `charge.dispute.created` / `charge.dispute.closed` — flags/unflags a purchase under
  dispute.
- `invoice.paid` — a subscription renewed: rolls the matching purchase's `expiresAt`
  forward to the new period end and (via `src/lib/notify.ts`) sends the buyer a
  receipt for the renewal.
- `invoice.payment_failed` — a renewal charge failed; the subscription and its
  `purchases` row are left alone (access doesn't drop until Stripe actually cancels
  the subscription after retries are exhausted — see the next event).
- `customer.subscription.updated` — plan or status changes (e.g. `past_due`,
  `cancel_at_period_end` toggled from the billing portal) mirrored onto the
  `purchases` row.
- `customer.subscription.deleted` — the subscription actually ended (canceled, or
  retries exhausted): access is revoked at that point rather than at the failed
  charge above, so a card that recovers mid-retry never causes a spurious lockout.
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

Each entry in `files` may also carry `encoding` (`"utf8"` — the default, `content`
is the text — or `"base64"` for a binary file, where `content` is base64) and `mode`
(the POSIX file mode as an integer, `420`/`0o644` or `493`/`0o755`; omitted means
`420`) — see [Package Format](/docs/package-format#binary-files) for the full binary-file
rules (size caps, which extensions are treated as binary automatically) and
[CLI Reference](/docs/cli) for how `openagents publish` packs and detects these
without you setting them by hand.

```ts
// 201 Created
{
  id: "me/my-package";
  version: "1.0.0";
  url: "/p/me/my-package";
  status: "live" | "pending" | "unlisted";
  scan: { score: number; flags: string[] }; // content scan result — see Trust & Safety below
}

// 400 Bad Request — validation failed
{ error: string, issues: string[] }
```

`status` is `"pending"` instead of `"live"` when this deployment has `REQUIRE_REVIEW=1`
set **and** this is a brand-new package (its first-ever version) — a pending package is
invisible to everyone but its owner and admins until approved from `/admin` (see
[Publishing](/docs/publishing)). Publishing a new version of an already-`live` package
always comes back `"live"` immediately, regardless of `REQUIRE_REVIEW` — the review
gate is about letting a new, unvetted package onto the platform, not re-reviewing
every update from an already-trusted publisher. Independently of `REQUIRE_REVIEW`,
every publish also runs the content scan described in
[Trust & Safety](#trust--safety) below: a `scan.score` of 70 or higher makes a
**brand-new** package start `pending` (same visibility as the review-mode case
above) or makes a **new version of an existing package** flip the whole package to
`unlisted` pending manual review — either way, `status` in this response reflects
the outcome.

`400` covers: manifest validation errors (same checks as `openagents validate`), the
manifest's `owner` not matching the authenticated user's handle,
`pricing.model: subscription` without a `pricing.interval` of `month` or `year` (see
[Package Format](/docs/package-format)), `pricing.currency` not a 3-letter code, the
new `version` not strictly greater than the package's current published version, and
file limits — at most 200 files, 512 KB per file, 2 MB total **text**, plus at most
2 MB total across all **binary** files (see [Package Format](/docs/package-format#binary-files)).

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

## Trust & Safety

### Content scan

Every publish (`POST /api/v1/publish`, `.../publish/import`, and a GitHub auto-sync
run) scans the submitted files against a fixed set of rules before the version is
accepted, and returns the result as `PublishResult.scan`:

```ts
type ScanResult = {
  score: number;    // 0 (clean) .. 100 (high risk)
  flags: string[];  // matched rule ids, e.g. ["prompt-injection-override", "network-unknown-host"]
};
```

| Rule id | Flags on |
|---|---|
| `prompt-injection-override` | Instructions attempting to override the installing agent's system prompt or prior instructions. |
| `hidden-text` | Zero-width characters, suspiciously-encoded (base64-looking) blobs, or text hidden via markdown/HTML tricks. |
| `credential-network-combo` | Reading credential-shaped files (`.env`, SSH keys, cloud config) combined with making a network call in the same file. |
| `network-unknown-host` | A network call to a host not in the manifest's declared `homepage`/`repository` domains or a well-known package registry. |
| `destructive-command` | Shell commands that delete, force-push, or otherwise irreversibly modify state without a guarded confirmation step. |
| `leaked-secret` | A pattern matching a real-looking API key, token, or connection string. |
| `obfuscated-eval` | `eval`/`exec`-style dynamic code execution fed from an encoded or concatenated string. |

`score >= 70`:
- **Brand-new package** (first-ever version): created `pending` instead of `live`
  (same visibility as the `REQUIRE_REVIEW` gate — owner/admin only until approved).
- **New version of an existing, already-`live` package**: the version still
  publishes, but the **package** is flipped to `unlisted` pending manual review —
  existing installs and direct links keep working, it just drops out of
  listings/search until an admin clears it.

A publisher sees the full `scan` result in the publish response regardless of
score; a false positive is appealable the same way a rejected/unlisted package is —
fix the flagged content (or, if it's a genuine false positive, report it — see
[Contributing](https://github.com/WolfeIntelligence/openagents/blob/main/CONTRIBUTING.md))
and publish a new version.

### `GET /api/v1/admin/scans?min=`

Recently-published versions with a scan score at or above `min` (default `0`, i.e.
everything scanned). Admin only — this is the moderation view at
[`/admin`](/admin)'s flagged-uploads tab.

```bash
curl "https://openagents-nu.vercel.app/api/v1/admin/scans?min=70" -H "Cookie: <session cookie>"
```

```ts
// 200 OK
{ items: Array<{ owner: string; name: string; version: string; score: number; flags: string[]; publishedAt: string; status: string }>; total: number }

// 401 Unauthorized / 403 Forbidden — same as the other admin routes
```

### Security advisories

Admin-posted advisories against a specific package, optionally scoped to a version
range, shown on the package page, in the API, and by the CLI at install time while
not withdrawn.

```ts
type Advisory = {
  id: string;
  owner: string;
  name: string;
  severity: "low" | "moderate" | "high" | "critical";
  title: string;
  body: string;
  affectedVersions: string | null; // semver range, e.g. "<1.3.0"; null = all versions
  fixedInVersion: string | null;
  createdAt: string;
  withdrawnAt: string | null;
};
```

#### `GET /api/v1/packages/{owner}/{name}/advisories`

```bash
curl "https://openagents-nu.vercel.app/api/v1/packages/openagents/pr-reviewer/advisories"
```

```ts
// 200 OK
{ items: Advisory[] } // non-withdrawn only, newest first

// 404 Not Found — package doesn't exist
```

#### `POST /api/v1/packages/{owner}/{name}/advisories`

Post a new advisory. Admin only.

```ts
// Body
{ severity: "low" | "moderate" | "high" | "critical"; title: string; body: string; affectedVersions?: string; fixedInVersion?: string }

// 201 Created — the new Advisory
// 401 Unauthorized / 403 Forbidden — not an admin
// 404 Not Found — package doesn't exist
```

#### `PATCH /api/v1/packages/{owner}/{name}/advisories/{id}`

Edit an advisory, or withdraw it (`{"withdraw": true}`). Admin only.

```ts
// Body — any subset of the POST body fields, or:
{ withdraw: true }

// 200 OK — the updated Advisory
// 401 Unauthorized / 403 Forbidden — not an admin
// 404 Not Found — package or advisory id doesn't exist
```

A package's detail response (`GET /api/v1/packages/{owner}/{name}`) carries
`advisories: Advisory[]` (non-withdrawn only) and `verifiedSource` (non-null once a
[linked GitHub source](#github-auto-sync) has synced at least once) — see
[Packages](#get-apiv1packagesownername) above. `openagents add`/`info` print open
advisories, and refuse to install a `critical`-severity one without `--force` — see
[CLI Reference](/docs/cli#advisories).

## Refunds

One-time purchases only (a subscription is canceled instead — see
[Subscriptions](/docs/publishing#subscriptions)), within a **14-day** window of
purchase.

### `POST /api/v1/refunds`

Request a refund. Session or a token with the `download` scope (refunds are scoped
to something you bought, same trust boundary as a paid download).

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/refunds" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"purchaseId": "...", "reason": "Does not do what the README describes."}'
```

```ts
// Body
{ purchaseId: string; reason: string }

// 201 Created
{ id: string; purchaseId: string; status: "open"; reason: string; createdAt: string }

// 400 Bad Request — purchase is a subscription, or is more than 14 days old
// 401 Unauthorized
// 404 Not Found — `purchaseId` doesn't exist or isn't the caller's
// 409 Conflict — a refund request already exists for this purchase
```

### `GET /api/v1/refunds?mine=1|seller=1`

List refund requests. `?mine=1` — the caller's own, as a buyer. `?seller=1` — refund
requests against packages the caller owns, as a seller. Session only.

```ts
// 200 OK
{ items: Array<{ id: string; purchaseId: string; reason: string; status: "open" | "approved" | "denied" | "refunded"; sellerNote?: string; createdAt: string; resolvedAt?: string }>; total: number }

// 401 Unauthorized
```

### `POST /api/v1/refunds/{id} {action: approve|deny, note?}`

Resolve a refund request. The purchase's seller, or an admin.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/refunds/<id>" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"action": "approve"}'
```

```ts
// Body
{ action: "approve" | "deny"; note?: string }

// 200 OK — the updated refund request
// 401 Unauthorized / 403 Forbidden — not the seller and not an admin
// 404 Not Found — refund request doesn't exist
// 409 Conflict — already resolved
```

Approving issues a **full Stripe refund** and reverses the Connect transfer,
refunding the platform's application fee along with the seller's share — the buyer
gets their money back in full, and the seller doesn't keep the fee-adjusted portion
either. Access to the package is revoked the same way it is for a `charge.refunded`
webhook event (see [`POST /api/webhooks/stripe`](#post-apiwebhooksstripe)).

### `GET /api/v1/admin/refunds`

Every refund request across the platform. Admin only.

```ts
// 200 OK
{ items: Array<{ id: string; purchaseId: string; owner: string; name: string; buyerHandle: string; reason: string; status: string; createdAt: string; resolvedAt?: string }>; total: number }

// 401 Unauthorized / 403 Forbidden
```

See [`/refund-policy`](/refund-policy) for the buyer-facing explanation of the
14-day window and one-time-purchase-only rule.

## Seller onboarding

### `POST /api/v1/validate`

Validate a set of package files before publishing — no authentication required, no
side effects. What the `/publish` wizard's **Check** step and a pre-flight linter
call before a creator commits to submitting.

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/validate" \
  -H "Content-Type: application/json" \
  -d '{"files": [{"path": "openagent.yaml", "content": "schema: 1\n..."}, {"path": "README.md", "content": "# ...\n"}]}'
```

```ts
// Body — same `files` shape as POST /api/v1/publish
{ files: Array<{ path: string; content: string; encoding?: "utf8" | "base64"; mode?: number }> }

// 200 OK
type ValidateResult = {
  valid: boolean;
  manifestIssues: string[]; // same checks as `openagents validate` / POST /api/v1/publish
  readmeFindings: Array<{ rule: string; message: string; severity: "error" | "warning" }>;
};
```

README lint rules (each a `rule` id in `readmeFindings`): `missing-title` (no `#`
heading), `missing-install-usage` (no install/usage section), `missing-example` (no
example invocation), `todo-placeholder` (`TODO`/`TBD`/`FIXME` left in), `too-short`
(under a minimum length for genuinely useful content), `broken-relative-link` (a
markdown link to a file not in the submitted `files`), and
`missing-tags-runtimes-homepage-hint` (a soft warning nudging toward filling in
optional manifest fields that improve discoverability). Only `manifestIssues` block
an actual publish; `readmeFindings` are advisory (shown in the wizard, don't fail
`POST /api/v1/publish`) except where a finding's `severity` is `"error"`.

## Ops

### Cron jobs

Three Vercel Cron routes, each authorized by a bearer token matching `CRON_SECRET`
(`Authorization: Bearer <CRON_SECRET>`) rather than a user session or personal
access token — see [Self-Hosting](/docs/self-hosting#cron-jobs).

| Route | Schedule | Does |
|---|---|---|
| `POST /api/cron/rollup-downloads` | Daily | Aggregates the prior UTC day's `download_events` into `download_rollups` (per package/day, with per-runtime and per-version breakdowns) — feeds `/dashboard` and `sort=trending` without scanning raw events as they grow. |
| `POST /api/cron/cleanup` | Hourly | Housekeeping: expires stale rate-limit windows, prunes unconfirmed/abandoned checkout artifacts, and similar. |
| `POST /api/cron/review-reminders` | Daily | Emails a reminder (via `src/lib/notify.ts`) for packages that have sat in the pending-review or scan-flagged queue past a threshold. |

```ts
// 200 OK
{ ok: true, processed: number }

// 401 Unauthorized — missing/incorrect bearer token
```

These aren't meant for direct client calls — Vercel's Cron scheduler invokes them
per `vercel.json`'s `crons` config, with `CRON_SECRET` injected as the bearer token
automatically on the hosted deployment.

### `GET /api/v1/admin/analytics?days=`

Platform-wide analytics (not scoped to one seller) powering
[`/admin/analytics`](/admin/analytics). Admin only.

```bash
curl "https://openagents-nu.vercel.app/api/v1/admin/analytics?days=30" -H "Cookie: <session cookie>"
```

```ts
type Analytics = {
  downloads: { total: number; byDay: Array<{ day: string; count: number }> };
  publishes: { total: number; byDay: Array<{ day: string; count: number }> };
  revenue: { totalCents: number; byDay: Array<{ day: string; amountCents: number }> };
  topPackages: Array<{ owner: string; name: string; downloads: number }>;
  scanFlags: Record<string, number>; // count of publishes flagged per rule id, over the window
};

// 200 OK — Analytics
// 401 Unauthorized / 403 Forbidden — not an admin
```

`days` is optional, defaults to `30`, backed by `download_rollups` (see **Cron
jobs** above) rather than scanning raw events.

### Search suggestions

`GET /api/v1/search?suggest=1&limit=6` returns a slim shape for a header's
search-as-you-type dropdown instead of the full search response:

```ts
// 200 OK — with ?suggest=1
{ items: Array<{ id: string; title: string; kind: "workflow" | "harness" | "rules" | "skill"; ownerType: "user" | "org" }> }
```

`limit` defaults to `6` and maxes at `10` when `suggest=1` (independent of the
normal search endpoint's `limit` default/max — a suggest dropdown needs far fewer
results, faster). Without `suggest=1`, `GET /api/v1/search` behaves exactly as
documented [above](#get-apiv1search).

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

Rate limits are now **durable**: counters live in Postgres (the `rate_limits` table,
a fixed window per `"<route>:<client>"` key) so a limit holds across every
serverless instance, not just the one that happened to handle a given request — a
deployment without `DATABASE_URL` configured falls back to the same in-memory,
per-instance limiter as before (best-effort, resets on cold start). A `429` response
always carries a `Retry-After` header (seconds), plus:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | The window's total request budget for this route/client. |
| `X-RateLimit-Remaining` | Requests left in the current window (`0` on the response that got `429`d). |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets and `Remaining` goes back to `Limit`. |

| Route | Limit |
|---|---|
| `.../download`, `.../versions/{version}/download` | 60 requests/minute/IP |
| `.../files/{path}` | 120 requests/minute/IP |
| `.../star` (POST) | 30 requests/minute/IP |
| `.../report` | 3/hour anonymous, 10/hour signed-in — anonymous reporting stays open (see [Publishing](/docs/publishing#content-policy)), just tightly capped, since it's the one unauthenticated write route most exposed to spam. |
| `POST /api/v1/tokens` | 10 requests/minute |
| `POST /api/v1/publish`, `POST /api/v1/publish/import`, `.../source/sync` | 10 requests/minute |
| `POST /api/v1/validate` | 30 requests/minute/IP — unauthenticated, so capped tighter than the authenticated publish routes above |
| `POST /api/v1/refunds` | 10 requests/minute |
| `POST /api/checkout` | 10 requests/minute |

## Content-Security-Policy

`next.config.ts` now sends an **enforcing** `Content-Security-Policy` header (not
`-Report-Only`) with a fresh, per-request nonce: `script-src 'self' 'nonce-<value>'
'strict-dynamic' https://js.stripe.com`, `frame-src https://js.stripe.com`, `img-src
'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com
https://*.stripe.com`, `connect-src 'self' https://api.stripe.com
https://*.sentry.io`. Every server-rendered `<script>` tag (including Next's own
hydration bootstrap) carries the request's nonce, and creator-supplied READMEs
render through `react-markdown` with raw HTML disabled — see
[Self-Hosting](/docs/self-hosting#content-security-policy) for the full policy string
and self-hosting implications (a self-hosted deployment adding its own inline
scripts needs to either nonce them or adjust the policy).

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
