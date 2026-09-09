// Runtime ids and install-directory mapping.
//
// Mirrors the mapping described in SPEC.md / src/lib/runtimes.ts conceptually,
// but is self-contained (the CLI ships with zero dependency on the site's
// source tree so it can be published and run standalone).

export const RUNTIME_IDS = [
  "claude-code",
  "cursor",
  "codex",
  "openai-agents",
  "langgraph",
  "generic",
];

/** Directory (relative to the project root) a package of `name` installs into for `runtime`. */
export function installDir(runtime, name) {
  switch (runtime) {
    case "claude-code":
      return `.claude/skills/${name}`;
    case "cursor":
      return `.cursor/rules/${name}`;
    case "codex":
      return `.codex/skills/${name}`;
    case "openai-agents":
      return `.openai-agents/${name}`;
    case "langgraph":
      return `.langgraph/${name}`;
    case "generic":
      return `.openagents/${name}`;
    default:
      throw new Error(`unknown runtime: ${runtime}`);
  }
}

/** Detect the runtime in use from marker directories in `dir` (default: cwd). */
export function detectRuntime(dir, existsSyncFn) {
  const exists = existsSyncFn;
  if (exists(`${dir}/.claude`)) return "claude-code";
  if (exists(`${dir}/.cursor`)) return "cursor";
  if (exists(`${dir}/.codex`)) return "codex";
  if (exists(`${dir}/.openai-agents`)) return "openai-agents";
  if (exists(`${dir}/.langgraph`)) return "langgraph";
  return "generic";
}
