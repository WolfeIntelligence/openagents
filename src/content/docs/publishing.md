---
title: Publishing
description: Two paths to publish a package — free via pull request, or paid via the hosted publish flow with Stripe Connect.
order: 6
---

# Publishing

There are two ways to publish a package to OpenAgents, depending on whether it's free
or paid.

## Free packages — pull request to `catalog/`

Free packages are contributed directly to the repository and ship bundled with the
site (the "seed" catalog), available even on a deployment with zero environment
variables configured.

1. Fork the repository.
2. Add a new directory: `catalog/<your-handle>/<package-name>/`.
3. Include, at minimum:
   - `openagent.yaml` — see [Package Format](/docs/package-format) for the full
     reference. `pricing.model` must be `free` and `pricing.amount_cents` must be `0`.
   - `README.md` — what it does, when to use it, per-runtime install notes, inputs,
     an example run, and known limitations.
   - The `entry` file and every file listed in `manifest.files`.
4. Open a pull request. See `CONTRIBUTING.md` in the repo root for the full quality
   bar (specific, step-by-step content — not filler — and everything in `files` must
   actually exist and be listed).
5. A maintainer reviews for: manifest validity (`openagents validate <dir>` must
   pass), content quality (genuinely useful, not a stub), no secrets/credentials
   committed, and license compatibility (MIT or another permissive SPDX id — the seed
   catalog doesn't accept `proprietary`).
6. Once merged, the package appears in the catalog on the next deploy — no separate
   publish step, since seed packages are read directly from `/catalog` at build time.

This path has no fee — free packages don't go through Stripe at all.

## Paid packages — hosted publish flow

Packages with a price (`pricing.model` of `one-time`; `subscription` is reserved but
not yet accepted — see [Package Format](/docs/package-format)) are published through
the hosted flow rather than a PR, since they need an account and a way to receive
payment.

1. Sign in with GitHub or Google at `/publish` (requires the deployment to have
   `AUTH_SECRET` plus at least one provider's client id/secret configured — see
   [Self-Hosting](/docs/self-hosting); on `openagents-nu.vercel.app` this is already set
   up).
2. Connect a payout account via **Stripe Connect** — required before a paid package
   can go live, since checkout needs somewhere to send the creator's share of each
   sale.
3. Submit the files (and an optional changelog) through the `/publish` form,
   programmatically via `POST /api/v1/publish` (see [API Reference](/docs/api)), from
   a public GitHub repo via [`POST /api/v1/publish/import`](#publish-from-github), or
   with `openagents publish` (see [CLI Reference](/docs/cli)) once you've
   `openagents login`'d.
4. Once validation passes, a **brand-new** package goes live immediately and is
   purchasable via Stripe Checkout right away — unless this deployment has
   `REQUIRE_REVIEW=1` set, in which case it's created as `pending` first (see below).
   Publishing a new **version** of an already-live package is always immediate,
   regardless of `REQUIRE_REVIEW`.

### Review mode (`REQUIRE_REVIEW=1`)

When the deployment operator sets `REQUIRE_REVIEW=1`, every brand-new package (not a
new version of an existing one) is created with `status: "pending"` instead of
`"live"`:

- A pending package is visible only to its owner and to admins — `GET
  /api/v1/packages/{owner}/{name}` 404s for anyone else, exactly as if the package
  didn't exist. It doesn't appear in `/explore`, search, or `/u/{owner}`.
- The publish response (`POST /api/v1/publish` / `.../publish/import`) reflects this:
  `{ ..., status: "pending" }` instead of `"live"`.
- An admin reviews it from `/admin`'s pending queue and approves or rejects it
  (`POST /api/v1/admin/packages/{owner}/{name}`). Approval flips it to `live`;
  rejection is a hard rejection — the owner is expected to fix and resubmit as a
  new version, or as a new package if the original was abandoned.
- Admins are any user with `users.isAdmin` set, or any handle listed in the
  `ADMIN_HANDLES` env var — see [Self-Hosting](/docs/self-hosting).

Most self-hosted instances (and `openagents-nu.vercel.app`) run without this set —
packages publish straight to `live`, exactly as described in step 4 above, and
moderation happens after the fact via [reports](#reporting-issues) instead of before
publish.

### Publish from GitHub

`POST /api/v1/publish/import` (and `openagents publish --from-github <url>`) publishes
directly from a public GitHub repository — no local checkout needed:

```bash
curl -X POST "https://openagents-nu.vercel.app/api/v1/publish/import" \
  -H "Authorization: Bearer oa_..." -H "Content-Type: application/json" \
  -d '{"repo": "github.com/me/my-package/tree/main/packages/reviewer"}'
```

`repo` accepts `github.com/{owner}/{repo}`, optionally with `/tree/{ref}/{subdir}` for
a non-default branch and/or a package that lives in a subdirectory of the repo (a
monorepo of packages, say). It fetches `openagent.yaml`, `README.md`, and every file
the manifest lists from that path, then runs through the exact same validation, file
limits, and `REQUIRE_REVIEW` behavior as submitting the files directly. Only public
repositories are supported. See [API Reference](/docs/api#post-apiv1publishimport)
for the full request/response shape.

### Platform fee

OpenAgents takes a **10% platform fee** (`PLATFORM_FEE_BPS = 1000` basis points,
configurable per-deployment by whoever runs the instance — a self-host can change this
env var) from each sale; the remainder is transferred to the creator's connected
Stripe account. The fee is disclosed on the checkout page before purchase.

### Content policy

By default (no `REQUIRE_REVIEW`), packages go live as soon as they pass validation —
there's no human review gate before publishing. Maintainers do enforce the following
after the fact, and will unlist (or, for repeat/severe violations, take down and
suspend the account behind) any package that breaks them:

- **Functional content** — the package must do what its summary/README claim; stub or
  placeholder content gets unlisted.
- **No malicious or deceptive instructions** — a package's files are read by an agent
  with real tool access; anything attempting prompt injection against the *installer's*
  agent, exfiltrating data, or instructing destructive actions without clear disclosure
  is grounds for immediate takedown and account suspension.
- **Licensing** — the license field must accurately describe the terms; misrepresenting
  a copied/derivative work as originally licensed is grounds for takedown.
- **No secrets or credentials** committed in package files.
- **Pricing transparency** — summary/README must not misrepresent what's free vs. what
  requires the paid tier, for packages that bundle both.

If you believe a published package violates this policy, report it —
`POST /api/v1/packages/{owner}/{name}/report` (no sign-in required — see
[API Reference](/docs/api#post-apiv1packagesownernamereport)) or the "Report" action on
the package's page — and see "Reporting issues" in `CONTRIBUTING.md` for the GitHub
Issues path too. Reports land in the admin queue (`/admin`) alongside anything pending
review.

## Package lifecycle

A package's `status` is one of:

| Status | Listed / searchable | Installable by URL | Notes |
|---|---|---|---|
| `pending` | No | Owner/admin only | Only reachable with `REQUIRE_REVIEW=1`; see above. |
| `live` | Yes | Yes | The normal state. |
| `unlisted` | No | Yes | Fully functional, just hidden from `/explore`, search, and the owner's public profile listing. Good for "shared by direct link only," or for quietly retiring something without breaking existing installs. |
| `deprecated` | Yes | Yes | Listed normally, but the package page shows a deprecation banner and `openagents add`/`update` print a warning at install/update time. |

The owner (or an admin) changes status with
`POST /api/v1/packages/{owner}/{name}/status`:

```bash
# Unlist
curl -X POST ".../api/v1/packages/me/my-package/status" \
  -H "Authorization: Bearer oa_..." -H "Content-Type: application/json" \
  -d '{"status": "unlisted"}'

# Deprecate, pointing at a replacement
curl -X POST ".../api/v1/packages/me/my-package/status" \
  -H "Authorization: Bearer oa_..." -H "Content-Type: application/json" \
  -d '{"status": "deprecated", "message": "Superseded by the v2 rewrite.", "replacementId": "me/my-package-v2"}'

# Delete permanently (only when the package has zero purchases ever)
curl -X POST ".../api/v1/packages/me/my-package/status" \
  -H "Authorization: Bearer oa_..." -H "Content-Type: application/json" \
  -d '{"action": "delete"}'
```

Deleting is permanent and rejected (`409 Conflict`) the moment a package has any
purchase history at all — once someone's paid for it, `unlisted` or `deprecated` is
the only way to retire it, so buyers keep access to what they bought. Seed packages
(anything under `catalog/`, not database-backed) can't be changed or deleted through
this route at all (`400 Bad Request`) — they're retired by removing them from the
repository instead. Full request/response reference:
[API Reference](/docs/api#post-apiv1packagesownernamestatus).

## Updating a published package

Bump `version` in `openagent.yaml` and resubmit (a new PR for free packages, or a new
submission through `/publish`/the API for paid ones). Versions are immutable once
published — fix forward with a new version rather than editing history — and a new
version must be **strictly greater**, by semver comparison, than the package's current
published version. Publishing a version that isn't strictly greater is rejected
(`409 Conflict` if that exact version already exists, `400 Bad Request` if it's equal
to or lower than the current version otherwise).

Include a changelog with the update: either the `changelog` field on
`POST /api/v1/publish` (surfaced as a form field on `/publish`), or the first section
of a `CHANGELOG.md` file included in `files`. Version history, with each version's
changelog, is shown on the package's detail page (`/p/[owner]/[name]`).

## Subscriptions

`pricing.model: subscription` is planned, not yet accepted — the registry rejects it
today (see [Package Format](/docs/package-format)). Publish as `one-time` in the
meantime.
