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
3. Submit the files (and an optional changelog) through the `/publish` form, or
   programmatically via `POST /api/v1/publish` (see [API Reference](/docs/api)).
4. Once validation passes, the package is live immediately — purchasable via Stripe
   Checkout right away. There's no pre-publish review queue.

### Platform fee

OpenAgents takes a **10% platform fee** (`PLATFORM_FEE_BPS = 1000` basis points,
configurable per-deployment by whoever runs the instance — a self-host can change this
env var) from each sale; the remainder is transferred to the creator's connected
Stripe account. The fee is disclosed on the checkout page before purchase.

### Content policy

Packages go live as soon as they pass validation — there's no human review gate before
publishing. Maintainers do enforce the following after the fact, and will unlist (or,
for repeat/severe violations, take down and suspend the account behind) any package
that breaks them:

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

If you believe a published package violates this policy, see "Reporting issues" in
`CONTRIBUTING.md`.

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
