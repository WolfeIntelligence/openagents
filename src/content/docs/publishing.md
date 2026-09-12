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

Packages with a price (`pricing.model` of `one-time` or `subscription` — see
[Package Format](/docs/package-format) and [Subscriptions](#subscriptions) below)
are published through the hosted flow rather than a PR, since they need an account
and a way to receive payment.

1. Sign in with GitHub or Google at `/publish` (requires the deployment to have
   `AUTH_SECRET` plus at least one provider's client id/secret configured — see
   [Self-Hosting](/docs/self-hosting); on `openagents-nu.vercel.app` this is already set
   up).
2. Connect a payout account via **Stripe Connect** — required before a paid package
   can go live, since checkout needs somewhere to send the creator's share of each
   sale.
3. Before submitting, run the wizard's **Check** step (or call
   [`POST /api/v1/validate`](#validate-before-publish) directly) to catch manifest
   and README problems ahead of time — see [Validate before publishing](#validate-before-publish)
   below.
4. Submit the files (and an optional changelog) through the `/publish` form,
   programmatically via `POST /api/v1/publish` (see [API Reference](/docs/api)), from
   a public GitHub repo via [`POST /api/v1/publish/import`](#publish-from-github), or
   with `openagents publish` (see [CLI Reference](/docs/cli)) once you've
   `openagents login`'d.
5. Every submission runs through the [content scan](#content-scan) before it's
   accepted. Assuming it isn't flagged, a **brand-new** package goes live
   immediately and is purchasable via Stripe Checkout right away — unless this
   deployment has `REQUIRE_REVIEW=1` set, in which case it's created as `pending`
   first (see below). Publishing a new **version** of an already-live package is
   always immediate, regardless of `REQUIRE_REVIEW`.

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
packages publish straight to `live`, exactly as described above, and moderation
happens after the fact via [reports](#reporting-issues) instead of before publish.

### Content scan

Independently of `REQUIRE_REVIEW`, every publish (`POST /api/v1/publish`,
`.../publish/import`, and a GitHub auto-sync run) is scanned for a fixed set of
risky patterns before the version is accepted. The response's `scan` field
(`{ score: 0..100, flags: string[] }`) is always returned, whatever the score —
see [API Reference](/docs/api#content-scan) for the full response shape.

| Rule id | What it catches |
|---|---|
| `prompt-injection-override` | Content that tries to override the *installing* agent's system prompt or prior instructions — the core risk of a marketplace whose product is agent instructions. |
| `hidden-text` | Zero-width characters, base64-looking blobs, or text hidden via markdown/HTML tricks a human reviewer would miss on a skim. |
| `credential-network-combo` | Reading a credential-shaped file (`.env`, SSH keys, cloud config) combined with a network call in the same file — the shape of an exfiltration attempt. |
| `network-unknown-host` | A network call to a host outside the manifest's declared `homepage`/`repository` domains or a well-known package registry. |
| `destructive-command` | Shell commands that delete, force-push, or otherwise irreversibly change state without a guarded confirmation step. |
| `leaked-secret` | A pattern matching a real-looking API key, token, or connection string committed into the package's own files. |
| `obfuscated-eval` | Dynamic code execution (`eval`/`exec`-style) fed from an encoded or concatenated string, the classic way to hide what code actually does from a reviewer. |

**If your package is flagged** (`score >= 70`):

- A **brand-new** package is created `pending` — same effect as the
  `REQUIRE_REVIEW` gate above, visible only to you and admins until approved.
- A **new version of an already-live package** still publishes, but the whole
  package flips to `unlisted` pending review — existing installs and direct links
  keep working, it just drops out of listings/search in the meantime.

Either way, nothing is silently rejected — check the `flags` in the response (or
`/admin`'s flagged-uploads tab, if you're an admin) against the table above, fix
the specific thing that tripped the rule, and publish a new version. A genuine
false positive (the rule matched something legitimate) is a bug — report it per
[Contributing](https://github.com/WolfeIntelligence/openagents/blob/main/CONTRIBUTING.md#code-contributions);
the rules themselves live in `src/lib/scan.ts` and are expected to run clean
against every seed catalog package.

### Security advisories

An admin can post a security advisory against any package — a specific
vulnerability, a version range it affects, and (once fixed) the version it's fixed
in. Advisories show up in three places: the package's own detail page, the API
(`GET /api/v1/packages/{owner}/{name}/advisories`), and the CLI, which prints open
advisories on `add`/`info` and **refuses to install a `critical`-severity one
without `--force`**:

```bash
openagents add someone/flagged-package
# ✗ critical advisory: <title> — re-run with --force to install anyway

openagents add someone/flagged-package --force
```

See [API Reference](/docs/api#security-advisories) for the full CRUD (admin-only to
post/edit/withdraw) and [CLI Reference](/docs/cli#advisories) for the install-time
behavior. A package's detail response also carries `verifiedSource` — non-null once
a [linked GitHub source](#github-auto-sync) has synced at least once, so a buyer can
see the package's published files were sourced from a specific repo/ref rather than
uploaded by hand.

### Validate before publishing

`POST /api/v1/validate` (no authentication, no side effects) checks a set of files
the same way `POST /api/v1/publish` would, without actually publishing anything —
manifest validation (identical checks to `openagents validate`) plus a README
linter: missing title, no install/usage section, no example invocation, leftover
`TODO`/`FIXME` placeholders, content that's too short to be useful, broken relative
links to files not in the submission, and a soft nudge toward filling in
`tags`/`runtimes`/`homepage` if they're thin. The `/publish` form's **Check** step
calls this before letting you move on to the actual submission — see
[API Reference](/docs/api#post-apiv1validate) for the request/response shape.

### Organizations

A package's `owner` can be a **user** handle or an **organization** handle — a
shared publisher identity with its own members. Create one from
[`/settings/orgs`](/settings/orgs) or `POST /api/v1/orgs`; each org gets a public
page at `/org/{handle}` listing its packages, bio, and website, same as a user
profile.

Membership has three roles:

| Role | Can publish/transfer under the org | Gets paid-download access to what the org owns |
|---|---|---|
| `owner` | Yes, plus manage membership and delete the org | Yes |
| `admin` | Yes | Yes |
| `member` | No | Yes |

Publishing a package with `owner` set to an org's handle in `openagent.yaml`
requires `owner` or `admin` membership at publish time — the same check applies to
[transferring an existing package](#transferring-a-package) to or from an org. The
last remaining `owner` member can't leave (`DELETE .../members/{userHandle}`
rejects it) — promote another member to `owner` first, or delete the org outright
once it owns zero packages. See [API Reference](/docs/api#organizations) for the
full membership API.

### Transferring a package

`POST /api/v1/packages/{owner}/{name}/transfer` moves a package to a different
user or organization handle — current owner or admin only, and (when transferring
*to* an org) requires `owner`/`admin` membership there. Purchases, reviews, and
stats move with the package; anything referencing the old `owner/name` (an install
command, a bookmarked URL) 404s afterward, the same as any other owner-handle
change. See [API Reference](/docs/api#post-apiv1packagesownernametransfer).

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

### Refunds

A buyer can request a refund on a one-time purchase within **14 days** of buying it
(`POST /api/v1/refunds` — subscriptions are canceled instead, not refunded through
this flow; see [Subscriptions](#subscriptions)). As the seller, you approve or deny
each request against your own packages:

```bash
curl "https://openagents-nu.vercel.app/api/v1/refunds?seller=1" -H "Cookie: <session cookie>"

curl -X POST "https://openagents-nu.vercel.app/api/v1/refunds/<id>" \
  -H "Cookie: <session cookie>" -H "Content-Type: application/json" \
  -d '{"action": "approve"}'
```

Approving issues a **full** Stripe refund to the buyer and reverses the Connect
transfer — you don't keep the fee-adjusted portion, and OpenAgents refunds its
platform fee too, so nobody is left holding part of a sale that got unwound.
Denying requires a `note` explaining why to the buyer; either action is final —
there's no re-opening a resolved request. An admin can also resolve a request on
your behalf if it goes unanswered (`/admin`'s refunds view,
`GET /api/v1/admin/refunds`). See [API Reference](/docs/api#refunds) for the full
request/response shapes, and [`/refund-policy`](/refund-policy) for the
buyer-facing explanation of the window and rules.

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

`pricing.model: subscription` is a real, third pricing model alongside `free` and
`one-time` — set `pricing.interval` to `month` or `year` (required for a subscription
manifest; see [Package Format](/docs/package-format)) and publish through the same
hosted flow as a one-time paid package.

Checkout runs in Stripe's subscription mode instead of a single charge: the buyer
gets a Stripe Customer (reused across every subscription they hold), and the
platform fee is taken via `application_fee_percent` on the subscription itself, so
it applies to **every renewal**, not just the first payment — the seller's connected
account receives the remainder on each billing cycle the same way it would for a
one-time sale. A buyer's access lasts until `expiresAt` (the current billing
period's end), which rolls forward automatically on each successful renewal
(`invoice.paid`) and is left alone if a renewal charge fails outright — access only
actually ends when Stripe reports the subscription itself as canceled
(`customer.subscription.deleted`), typically after Stripe's own retry schedule is
exhausted. See [API Reference](/docs/api#post-apicheckout) for the full webhook
event list.

A subscriber manages their own subscription — updating a card, canceling, seeing the
next renewal date — through Stripe's hosted **billing portal**, reached via
[`POST /api/billing/portal`](/docs/api#post-apibillingportal). [`/purchases`](/purchases)
shows each subscription's renewal or end date next to a **Manage** button that opens
that portal; it shows the equivalent purchase date for one-time purchases.

`openagents publish`/`validate` and the manifest schema all accept `pricing.interval`
today — see [CLI Reference](/docs/cli) and [Package Format](/docs/package-format).

## Binary files

A paid or free package can ship binary files (an icon, a small compiled asset) in
addition to text — see [Package Format](/docs/package-format#binary-files) for the
full `encoding`/`mode` fields and size cap (2 MB total across all binary files, on
top of the existing text limits). `openagents publish` packs these automatically —
you don't need to base64-encode anything by hand — and preserves the POSIX
executable bit for scripts when publishing from a POSIX machine. The raw file route
serves a binary file with its real content type: images render inline; anything
else downloads as an attachment.

## GitHub auto-sync

Beyond a one-off `--from-github` import (above), a package can be **linked** to a
GitHub repository so a new release (or tag push) republishes it automatically —
no need to run `openagents publish` again for every update.

1. From [`/settings/sources`](/settings/sources), or directly via
   [`PUT /api/v1/packages/{owner}/{name}/source`](/docs/api#putgetdelete-apiv1packagesownernamesource),
   link the package to `{repo, ref?, subdir?}`.
2. The response includes a webhook URL (`/api/webhooks/github/{id}`) and a secret,
   shown exactly once — add both to the GitHub repository's webhook settings
   (Settings → Webhooks → Add webhook), subscribed to the **release** event (and,
   optionally, tag pushes).
3. Publishing a GitHub release (or pushing a matching tag) fires the webhook, which
   imports the manifest at that ref/subdir and publishes a new version — but only
   when its `version` is strictly greater than the currently published one, so a
   re-delivered webhook or an out-of-order release never double-publishes.
4. `POST .../source/sync` triggers the same check on demand, without waiting for a
   webhook — useful right after linking a repo that already has releases.

This goes through the exact same validation, file limits, and `REQUIRE_REVIEW`
behavior as any other publish path.

## Collections for curation

Once a package is live, it can be added to **collections** — curated, ordered lists
a creator (or an admin, editorially) puts together, e.g. "everything you need for PR
review." See [API Reference](/docs/api#collections) for the full CRUD; from the UI,
use "Add to collection" on a package's own page, or start a new one at
[`/collections/new`](/collections/new). A public collection appears on
[`/collections`](/collections), at `/c/{handle}/{slug}`, in the landing page's
collections rail, and in the sitemap; an unlisted one is reachable only by direct
link, the same visibility model as an unlisted package.
