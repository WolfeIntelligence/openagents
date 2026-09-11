// Runtime metadata (install target layout per runtime) and package-kind
// display metadata. See SPEC.md "Package format" / "Architecture".
//
// SOURCE OF TRUTH: `cli/lib/runtimes.js`'s `installDir()` is authoritative —
// the CLI is what actually writes files to disk. The six `installDir`
// strings below (and the docs table in src/content/docs/runtimes.md) must
// be kept byte-for-byte in sync with it. cli/test/ asserts the CLI and site
// tables agree (a literal table on each side, since the CLI cannot import
// from src/); update both when either changes.

import { RUNTIME_IDS, PACKAGE_KINDS, type RuntimeId, type PackageKind } from "@/lib/types";

export interface RuntimeMeta {
  id: RuntimeId;
  label: string;
  /** Directory a package named `name` installs into, relative to the project root. */
  installDir: (name: string) => string;
  description: string;
}

export const RUNTIMES: Record<RuntimeId, RuntimeMeta> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    installDir: (name) => `.claude/skills/${name}/`,
    description: "Anthropic's official CLI agent. Installs as a Claude Code skill.",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    installDir: (name) => `.cursor/rules/${name}/`,
    description: "Cursor editor. Installs as a project rules directory.",
  },
  codex: {
    id: "codex",
    label: "Codex CLI",
    installDir: (name) => `.codex/skills/${name}/`,
    description: "OpenAI's Codex CLI agent. Installs as a Codex skill.",
  },
  "openai-agents": {
    id: "openai-agents",
    label: "OpenAI Agents SDK",
    installDir: (name) => `.openai-agents/${name}/`,
    description: "OpenAI Agents SDK. Installs as an agent definition directory.",
  },
  langgraph: {
    id: "langgraph",
    label: "LangGraph",
    installDir: (name) => `.langgraph/${name}/`,
    description: "LangGraph. Installs as a graph definition directory.",
  },
  generic: {
    id: "generic",
    label: "Generic",
    installDir: (name) => `.openagents/${name}/`,
    description: "Any other runtime. Installs as a plain files directory.",
  },
};

export interface KindMeta {
  label: string;
  description: string;
  /** Tailwind color token name (e.g. "blue", "violet") — not a literal class. */
  color: string;
}

export const KIND_META: Record<PackageKind, KindMeta> = {
  workflow: {
    label: "Workflow",
    description: "A multi-step, goal-directed procedure an agent executes.",
    color: "blue",
  },
  harness: {
    label: "Harness",
    description: "Scaffolding around an agent: loop control, tool wiring, eval hooks, guards.",
    color: "violet",
  },
  rules: {
    label: "Rules",
    description: "Constraints / style / policy files an agent must obey.",
    color: "amber",
  },
  skill: {
    label: "Skill",
    description: "A reusable capability with its own instructions + helper scripts.",
    color: "emerald",
  },
};

// Re-exported for convenience so callers only need `import from "@/lib/runtimes"`.
export { RUNTIME_IDS, PACKAGE_KINDS };

/** Builds the `npx <cli> add ...` install command shown in the UI / docs. `cli` is the
 *  package spec npx runs — `cliSpec()` from src/lib/site.ts on the server (the site's own
 *  tarball until the npm package exists); client components receive it as a prop. */
export function installCommand(
  owner: string,
  name: string,
  runtime?: RuntimeId,
  cli: string = "openagents-cli"
): string {
  const base = `npx ${cli} add ${owner}/${name}`;
  return runtime ? `${base} --runtime ${runtime}` : base;
}
