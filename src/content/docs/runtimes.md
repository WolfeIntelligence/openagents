---
title: Runtimes
description: Which agent runtimes OpenAgents supports, where packages install to, and how each one picks up the files.
order: 4
---

# Runtimes

A package declares which runtimes it supports in `manifest.runtimes`. The install
command (`openagents add`) picks the install directory from this table, either from an
explicit `--runtime` flag or by auto-detecting the current runtime from marker
directories already present in your project.

| Runtime id | Label | Installs to | Auto-detected by |
|---|---|---|---|
| `claude-code` | Claude Code | `.claude/skills/<name>/` | `.claude/` present |
| `cursor` | Cursor | `.cursor/rules/<name>/` | `.cursor/` present |
| `codex` | Codex CLI | `.codex/skills/<name>/` | `.codex/` present |
| `openai-agents` | OpenAI Agents SDK | `.openai-agents/<name>/` | `.openai-agents/` present |
| `langgraph` | LangGraph | `.langgraph/<name>/` | `.langgraph/` present |
| `generic` | Generic / any runtime | `.openagents/<name>/` | fallback when nothing else matches |

Detection checks the list top-to-bottom against the target directory (`--dir`, default
the current directory) and stops at the first match; `generic` is the fallback so
`openagents add` always succeeds even in a project with no runtime-specific directory
yet.

## How each runtime picks the files up

- **Claude Code** reads skills from `.claude/skills/<name>/`. The package's `entry`
  file (by convention `SKILL.md` for `skill`-kind packages, but any kind can be
  installed here) is what Claude Code loads when the skill is invoked; supporting
  files (templates, checklists) are referenced by relative path from `entry`.
- **Cursor** reads project rules from `.cursor/rules/`. Installing a package places its
  files under `.cursor/rules/<name>/`; reference `entry` from your own Cursor rule
  configuration if your Cursor version expects a single top-level rules file rather
  than a subdirectory per package.
- **Codex CLI** and **OpenAI Agents SDK** projects typically load instruction files
  explicitly (e.g. via a system prompt include or a tool that reads from disk) — point
  your project's own bootstrap at `<install-dir>/<entry>`.
- **LangGraph** graphs commonly load rules/workflow text as a node's system prompt or
  as a tool's documentation — same pattern: read `<install-dir>/<entry>` from wherever
  your graph is constructed.
- **Generic** (`.openagents/<name>/`) is the runtime-agnostic fallback: a plain
  directory with the manifest and files, for any setup that isn't one of the above
  (a custom harness, a script-based agent, or manual reading by a human). There's no
  automatic pickup — treat it as "the files are here, wire them in yourself."

## Multi-runtime packages

Most seed packages list several runtimes (all list `claude-code` and `generic` at
minimum) because the content — markdown instructions, templates — is runtime-agnostic;
only the install *location* differs. A package that genuinely needs runtime-specific
mechanics (e.g. a harness relying on a specific SDK's hook system) should scope
`runtimes` down to only the ones it actually works correctly in, rather than listing
everything.

## Installing for a specific runtime

```bash
openagents add openagents/pr-reviewer --runtime cursor
```

If a package's manifest doesn't list the runtime you asked for, the install still
proceeds (the file format is generally portable) — but check the package's README for
any runtime-specific caveats first.
