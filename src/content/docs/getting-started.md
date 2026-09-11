---
title: Getting Started
description: Install your first OpenAgents package and understand how the pieces fit together.
order: 1
---

# Getting Started

OpenAgents is an open-source marketplace for **agentic workflows, harnesses, rules,
and skills** — packaged agent behaviors you install into your own agent runtime
(Claude Code, Cursor, Codex CLI, OpenAI Agents SDK, LangGraph, or a generic layout),
the way you'd install a package from npm or a model from Hugging Face.

## Install a package

The fastest way to try OpenAgents is the CLI, run without installing anything —
**once `openagents` is published to npm** (it ships from [`cli/`](https://github.com/WolfeIntelligence/openagents/tree/main/cli)
as its own package, released by the `cli-v*` tag workflow; until a release has shipped,
`npx openagents` and `npx github:WolfeIntelligence/openagents` won't resolve, since npm
git specifiers run whatever `bin` the *repository root's* `package.json` declares, and
that's the site, not the CLI). Until then, clone the repo and run the CLI directly from
source:

```bash
git clone https://github.com/WolfeIntelligence/openagents.git
cd openagents/cli && npm install
node bin/openagents.js add openagents/pr-reviewer
```

Once a release is out, the one-liner will be:

```bash
npx openagents-cli add openagents/pr-reviewer
```

This does three things:
1. Fetches the package manifest from the registry (`https://openagents-nu.vercel.app` by
   default).
2. Downloads the package's files as a tarball.
3. Extracts them into the right directory for your project's runtime — auto-detected
   from marker directories (`.claude/`, `.cursor/`, `.codex/`, etc.), or set explicitly:

```bash
npx openagents-cli add openagents/pr-reviewer --runtime claude-code
```

See [CLI Reference](/docs/cli) for every command, and [Runtimes](/docs/runtimes) for
the full install-directory table and how each runtime picks the files up.

## Browse without installing

- **Web**: [`/explore`](/explore) — filter by kind, runtime, price, and search text.
- **API**: `GET /api/v1/search?q=code+review` — see [API Reference](/docs/api).
- **CLI**: `npx openagents-cli search "code review"`.
- **Collections**: [`/collections`](/collections) — curated, ordered lists of
  packages someone put together around a theme ("everything for PR review"), each
  with a one-paste "copy install-all" command; see
  [Publishing](/docs/publishing#collections-for-curation).
- **RSS**: [`/feed.xml`](/feed.xml) for newly published/updated packages, if you'd
  rather watch the catalog from a feed reader than check back on `/explore`.

Each package's detail page (`/p/<owner>/<name>`) shows its README, full manifest, file
tree, and version history before you install anything. A creator can also embed
status badges (version, downloads, stars, rating) from
`GET /api/v1/packages/{owner}/{name}/badge` in their own README or site — see
[API Reference](/docs/api#badges).

## Understand what you're installing

Every package is a directory with an `openagent.yaml` manifest plus a `README.md` and
its actual files (an instruction file, templates, scripts, schemas — whatever the
package needs). There are four **kinds** — `workflow`, `harness`, `rules`, `skill` —
each meant to be loaded into your agent's context differently. Read
[Package Format](/docs/package-format) for the full manifest reference and
[Kinds](/docs/kinds) for what distinguishes each one.

## Try the free catalog

28 packages ship free and bundled with the project under `catalog/openagents/` —
no sign-in, no payment, always available even with zero environment variables
configured server-side. A good first one to try:

```bash
npx openagents-cli info openagents/pr-reviewer
npx openagents-cli add openagents/pr-reviewer
```

## Publish your own

Free packages are contributed via pull request to the `catalog/` directory; packages
with a price go through the hosted publish flow (or `openagents publish` from the
CLI, once you've `openagents login`'d — see [CLI Reference](/docs/cli)) and go live
immediately once validation passes, unless the deployment requires review first. See
[Publishing](/docs/publishing) for both paths, review mode, and the content policy.

## Run OpenAgents yourself

The whole app builds and runs with **zero environment variables set** — it falls back
to the bundled seed catalog with auth and payments disabled. See
[Self-Hosting](/docs/self-hosting) to deploy your own instance, optionally with a
database, GitHub/Google auth, and Stripe Connect payments enabled.
