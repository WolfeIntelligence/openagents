---
title: Package Format
description: Full field-by-field reference for openagent.yaml, the manifest every OpenAgents package ships.
order: 2
---

# Package Format

A package is a directory containing `openagent.yaml`, a `README.md`, and any number
of supporting files. `openagent.yaml` is the authoritative manifest — the site and CLI
both validate against it, and its keys are **snake_case** on disk (mapped to camelCase
internally, e.g. `amount_cents` → `amountCents`).

## Example

```yaml
schema: 1
name: pr-reviewer
owner: openagents
version: 1.2.0
kind: workflow
title: Pull Request Reviewer
summary: One-line description (<= 160 chars)
license: MIT
tags: [code-review, github, quality]
runtimes: [claude-code, cursor, codex, generic]
pricing:
  model: free            # free | one-time | subscription
  amount_cents: 0
  currency: usd
  # interval: month       # required when model is "subscription" ("month" or "year")
entry: WORKFLOW.md
files:
  - WORKFLOW.md
  - rules/review-checklist.md
inputs:
  - name: repo
    type: string
    required: true
    description: owner/name of the repository
requires:
  - openagents/base-rules@^1
```

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema` | integer | yes | Must be exactly `1` (the only manifest schema version today). |
| `name` | string | yes | Package identifier. Must match `^[a-z0-9-]{2,64}$` — lowercase, digits, hyphens. |
| `owner` | string | yes | Creator handle. Same format as `name`. A package's id is `owner/name`. |
| `version` | string | yes | Semver, e.g. `1.2.0`. Optional `-prerelease` and `+build` suffixes are accepted. |
| `kind` | string | yes | One of `workflow`, `harness`, `rules`, `skill`. See [Kinds](/docs/kinds). |
| `title` | string | yes | Human-readable display name. |
| `summary` | string | yes | One-line description, **≤ 160 characters**. Shown in listings. |
| `license` | string | yes | Should be an SPDX identifier (e.g. `MIT`, `Apache-2.0`), or the literal string `proprietary` for paid packages that don't grant redistribution rights. |
| `tags` | string[] | no (default `[]`) | Free-form tags used for filtering/search. Convention: 3–6 tags, lowercase, hyphenated. Search treats hyphens as spaces, so `code-review` also matches the terms `code` and `review` individually — see [API Reference](/docs/api). |
| `runtimes` | string[] | no (default `[]`) | Which runtimes this package supports. Values from the [runtime id list](/docs/runtimes). Should be non-empty in practice — the install command needs at least one supported runtime. |
| `pricing` | object | yes (defaults to free) | See **Pricing object** below. |
| `entry` | string | yes | The main file an agent reads first. Must appear in `files`. |
| `files` | string[] | yes | Every shipped file, as paths relative to the package root. Must include `entry`. The registry and CLI both reject a manifest whose `files`/`entry` don't match what's actually on disk. The registry additionally caps a submission at 200 files, 512 KB per file, and 2 MB total text content, plus up to 2 MB total across any binary files — see **Binary files** below. |
| `inputs` | object[] | no (default `[]`) | Declared runtime parameters. See **Input object** below. |
| `requires` | string[] | no (default `[]`) | Dependencies on other packages, as `"owner/name@range"` (npm-style semver range), e.g. `openagents/base-rules@^1`. Resolved client-side by CLI 0.3.0's `openagents add` (transitively — a dependency's own `requires` are followed too — with cycle and version-conflict detection; `--no-deps` skips resolution entirely), fetched via [`GET /versions`](/docs/api#get-apiv1packagesownernameversions) on the registry. Still not resolved server-side — the registry itself doesn't install or validate dependency graphs at publish time. |
| `homepage` | string (URL) | no | Optional link to a project homepage. |
| `repository` | string (URL) | no | Optional link to the source repository. |

### Pricing object

| Field | Type | Required | Notes |
|---|---|---|---|
| `model` | string | yes | `free`, `one-time`, or `subscription`. |
| `amount_cents` | integer | yes | `0` when `model` is `free`. Must be `> 0` for `one-time`/`subscription` — a paid package with `amount_cents: 0` fails validation. For `subscription`, this is the amount charged **per interval** (e.g. `900` + `interval: month` is $9/month). |
| `currency` | string | yes | A 3-letter, lowercase ISO 4217 currency code (e.g. `usd`, `eur`, `jpy`) that Stripe also supports — an unrecognized or non-3-letter code is rejected at publish. Zero-decimal currencies (e.g. `jpy`) are charged as whole units: `amount_cents: 500` for a `jpy` package charges ¥500, not ¥5.00. |
| `interval` | string | only for `subscription` | `month` or `year`. Required whenever `model: subscription`; the registry rejects a subscription manifest with no `interval` (`400 Bad Request`) since Stripe needs a billing period to create the underlying Price. Ignored (and unnecessary) for `free`/`one-time`. |

## Binary files

A package can ship binary files (images, small compiled assets, an icon a HARNESS.md
references) alongside its text content. At the API level (see
[`POST /api/v1/publish`](/docs/api#post-apiv1publish)), each entry in the `files`
array submitted to the registry may carry two extra fields the manifest itself
doesn't have:

| Field | Type | Notes |
|---|---|---|
| `encoding` | string | `"utf8"` (default) for text — `content` is the text itself — or `"base64"` for a binary file, where `content` is the file's bytes, base64-encoded. |
| `mode` | integer | POSIX file mode. `420` (`0o644`, the default when omitted) for a regular file, or `493` (`0o755`) for something meant to be executable, e.g. a helper script under `scripts/`. |

Rules enforced at publish time:

- Binary files (anything submitted with `encoding: "base64"`) are capped at **2 MB
  total** across the whole submission, on top of the existing 200-file / 512 KB-per-file
  / 2 MB-total-text limits for everything else — a package can carry both a full
  text budget and a full binary budget at once, not one shared pool.
- The published tarball preserves each file's `mode`, so an executable script
  extracted from it is still executable on POSIX systems without a manual `chmod`.
- The raw file route
  ([`GET /api/v1/packages/{owner}/{name}/files/{path}`](/docs/api#get-apiv1packagesownernamefilespath))
  serves a binary file with its real, extension-inferred `Content-Type` — an image
  is served inline (`Content-Disposition` omitted so a browser renders it directly),
  anything else as `attachment`.
- `openagents publish` (CLI 0.4.0+) packs binary files automatically — it detects
  them by content (not just extension), base64-encodes them, and preserves the
  executable bit from disk (`mode: 493`) when packing on POSIX — see
  [CLI Reference](/docs/cli#binary-files). Windows has no POSIX executable bit to
  read, so files packed from a Windows machine always publish with `mode: 420`
  unless a package author sets it explicitly some other way.
- `openagents validate` (the local, offline check) doesn't enforce the 2 MB binary
  cap — that's a registry-only rule, same as the existing file-count/size limits.

### Input object (`inputs[]`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Parameter name. |
| `type` | string | yes | One of `string`, `number`, `boolean`, `path`, `url`. |
| `required` | boolean | yes | Whether the caller must supply this input. |
| `description` | string | no | Human-readable explanation. |
| `default` | string \| number \| boolean | no | Default value used when the input is omitted and `required` is `false`. |

## Validation rules (what a linter/registry checks)

- `name` and `owner` match `^[a-z0-9-]{2,64}$`.
- `version` is valid semver.
- `kind` is one of the four defined kinds.
- `summary` is ≤ 160 characters.
- `pricing.model` is `free`, `one-time`, or `subscription`; `amount_cents` is a
  non-negative integer, and `> 0` whenever `model` isn't `free`; `currency` is a
  3-letter lowercase code Stripe supports; `pricing.interval` is `month` or `year`
  and **required** when `model` is `subscription`.
- `entry` is present in `files`.
- Every path in `files` (and `entry`) exists on disk in the package directory.
- `runtimes` values are all recognized runtime ids.
- `inputs[].type` is one of the five allowed input types.
- (Registry only, not the CLI's local `validate`) `files` has at most 200 entries, no
  file over 512 KB, 2 MB total text content, and at most 2 MB total across any binary
  (`encoding: "base64"`) files — see [Binary files](#binary-files); the submitting
  user's handle matches `owner`; the new `version` is strictly greater than the
  package's current published version.

The CLI's `openagents validate [dir]` command runs exactly these checks locally, with
no external dependency — see [CLI Reference](/docs/cli). Registry-side, a package's
*content* (not just its manifest) is also run through the automated
[content scan](/docs/publishing#content-scan) at publish time — a separate check
from the structural validation above, covering things like prompt-injection
attempts and unexpected network calls rather than manifest shape.

## Directory conventions

- Put procedure/instruction content in the file named by `entry` — the convention by
  kind is `WORKFLOW.md`, `HARNESS.md`, `RULES.md`, `SKILL.md`, but any filename works
  as long as `entry` points to it.
- Group supporting files by purpose in subdirectories: `templates/`, `rules/`,
  `checklists/`, `policies/` are common in the seed catalog.
- Every file the package needs at runtime must be listed in `files` — files present on
  disk but not listed won't be considered part of the package (and, depending on
  registry implementation, may not be included in the downloadable tarball).
