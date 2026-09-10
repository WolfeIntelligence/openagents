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

Installing a package copies its files into the table above, then `openagents add`
writes a runtime-specific **discovery shim** so the target runtime actually finds it —
a directory of files alone isn't enough for Claude Code or Cursor to notice a package.

- **Claude Code** discovers skills only via a `SKILL.md` with `name`/`description`
  YAML frontmatter. `add` writes `.claude/skills/<name>/SKILL.md` with frontmatter
  generated from the manifest (`name`, `description` from `summary`) pointing at
  `entry` — if `entry` already *is* a bare `SKILL.md` with no frontmatter, the CLI
  prepends the frontmatter to it instead of creating a second file. After install, `add`
  prints a hint to restart Claude Code (or reload the window) so it picks up the new
  skill.
- **Codex** uses the same `SKILL.md`-with-frontmatter convention as Claude Code; `add`
  writes it the same way under `.codex/skills/<name>/SKILL.md`.
- **Cursor** discovers rules only via a top-level `.mdc` file under `.cursor/rules/`.
  `add` writes `.cursor/rules/<name>.mdc` — a small frontmatter'd rule file that
  references `@.cursor/rules/<name>/<entry>` — alongside the full package contents at
  `.cursor/rules/<name>/`, so Cursor's rule index picks it up without needing every
  supporting file flattened to the top level. `add` prints a hint to check Cursor's
  rules panel after install.
- **OpenAI Agents SDK** projects typically load instruction files explicitly (e.g. via
  a system prompt include or a tool that reads from disk) — point your project's own
  bootstrap at `<install-dir>/<entry>`. No shim is generated; `add` prints a hint with
  the exact path to wire in.
- **LangGraph** graphs commonly load rules/workflow text as a node's system prompt or
  as a tool's documentation — same pattern: read `<install-dir>/<entry>` from wherever
  your graph is constructed. No shim is generated; `add` prints the path.
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
