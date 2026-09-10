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
  model: free
  amount_cents: 0
  currency: usd
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
| `files` | string[] | yes | Every shipped file, as paths relative to the package root. Must include `entry`. The registry and CLI both reject a manifest whose `files`/`entry` don't match what's actually on disk. The registry additionally caps a submission at 200 files, 512 KB per file, and 2 MB total, and rejects binary files — see [Publishing](/docs/publishing). |
| `inputs` | object[] | no (default `[]`) | Declared runtime parameters. See **Input object** below. |
| `requires` | string[] | no (default `[]`) | Dependencies on other packages, as `"owner/name@range"` (npm-style semver range), e.g. `openagents/base-rules@^1`. Still informational only — not auto-installed by the CLI, and not resolved by the registry. |
| `homepage` | string (URL) | no | Optional link to a project homepage. |
| `repository` | string (URL) | no | Optional link to the source repository. |

### Pricing object

| Field | Type | Required | Notes |
|---|---|---|---|
| `model` | string | yes | `free` or `one-time`. `subscription` is a reserved value for a planned future model — the registry currently rejects any submission with `pricing.model: subscription` (`400 Bad Request`). Publish as `one-time` in the meantime. |
| `amount_cents` | integer | yes | `0` when `model` is `free`. Must be `> 0` for `one-time` — a paid package with `amount_cents: 0` fails validation. |
| `currency` | string | yes | A 3-letter, lowercase ISO 4217 currency code (e.g. `usd`, `eur`, `jpy`) that Stripe also supports — an unrecognized or non-3-letter code is rejected at publish. Zero-decimal currencies (e.g. `jpy`) are charged as whole units: `amount_cents: 500` for a `jpy` package charges ¥500, not ¥5.00. |

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
- `pricing.model` is `free` or `one-time` (`subscription` is rejected); `amount_cents`
  is a non-negative integer, and `> 0` whenever `model` isn't `free`; `currency` is a
  3-letter lowercase code Stripe supports.
- `entry` is present in `files`.
- Every path in `files` (and `entry`) exists on disk in the package directory.
- `runtimes` values are all recognized runtime ids.
- `inputs[].type` is one of the five allowed input types.
- (Registry only, not the CLI's local `validate`) `files` has at most 200 entries, no
  file over 512 KB, 2 MB total, and no binary files; the submitting user's handle
  matches `owner`; the new `version` is strictly greater than the package's current
  published version.

The CLI's `openagents validate [dir]` command runs exactly these checks locally, with
no external dependency — see [CLI Reference](/docs/cli).

## Directory conventions

- Put procedure/instruction content in the file named by `entry` — the convention by
  kind is `WORKFLOW.md`, `HARNESS.md`, `RULES.md`, `SKILL.md`, but any filename works
  as long as `entry` points to it.
- Group supporting files by purpose in subdirectories: `templates/`, `rules/`,
  `checklists/`, `policies/` are common in the seed catalog.
- Every file the package needs at runtime must be listed in `files` — files present on
  disk but not listed won't be considered part of the package (and, depending on
  registry implementation, may not be included in the downloadable tarball).
