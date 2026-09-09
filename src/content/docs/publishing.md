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

Packages with a price (`pricing.model` of `one-time` or `subscription`) are published
through the hosted flow rather than a PR, since they need an account and a way to
receive payment.

1. Sign in with GitHub at `/publish` (requires the deployment to have
   `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`/`AUTH_SECRET` configured — see
   [Self-Hosting](/docs/self-hosting); on `openagents-nu.vercel.app` this is already set
   up).
2. Connect a payout account via **Stripe Connect** (Express accounts) — required
   before a paid package can go live, since checkout needs somewhere to send the
   creator's share of each sale.
3. Submit the manifest and files through the `/publish` form, or programmatically via
   `POST /api/v1/publish` (see [API Reference](/docs/api)).
4. The package enters review (see **Review policy** below). Once approved, it's live
   and purchasable via Stripe Checkout.

### Platform fee

OpenAgents takes a **10% platform fee** (`PLATFORM_FEE_BPS = 1000` basis points,
configurable per-deployment by whoever runs the instance — a self-host can change this
env var) from each sale; the remainder is transferred to the creator's connected
Stripe account. The fee is disclosed on the checkout page before purchase.

### Review policy

Every paid submission (and, at maintainer discretion, community-flagged free
submissions) is reviewed before going live or staying live:

- **Manifest validity** — passes the same checks as `openagents validate`, plus the
  paid-specific rule that `amount_cents > 0`.
- **Functional content** — the package must do what its summary/README claim; stub or
  placeholder content is rejected.
- **No malicious or deceptive instructions** — a package's files are read by an agent
  with real tool access; anything attempting prompt injection against the *installer's*
  agent, exfiltrating data, or instructing destructive actions without clear disclosure
  is rejected outright and the creator's account may be suspended.
- **Licensing** — the license field must accurately describe the terms; misrepresenting
  a copied/derivative work as originally licensed is grounds for takedown.
- **No secrets or credentials** committed in package files.
- **Pricing transparency** — summary/README must not misrepresent what's free vs. what
  requires the paid tier, for packages that bundle both.

Reviews are typically manual for now given catalog size; expect a delay between
submission and going live. A rejected submission gets a reason and can be resubmitted
after fixes.

## Updating a published package

Bump `version` (semver) in `openagent.yaml` and resubmit (a new PR for free packages,
or a new submission through `/publish`/the API for paid ones). Version history is
shown on the package's detail page (`/p/[owner]/[name]`); each version is immutable
once published — fix forward with a new version rather than editing history.
