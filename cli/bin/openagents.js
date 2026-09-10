#!/usr/bin/env node
// OpenAgents CLI — install, search, and scaffold agentic workflows/harnesses/
// rules/skills from the OpenAgents marketplace.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

const HELP = `openagents ${pkg.version} — CLI for the OpenAgents marketplace

Usage:
  openagents add <owner/name[@version]> [--runtime <id>] [--registry <url>] [--dir <path>]
  openagents search <query> [--registry <url>] [--json]
  openagents info <owner/name[@version]> [--registry <url>] [--json]
  openagents list [--dir <path>] [--json]
  openagents remove <owner/name> [--dir <path>] [--runtime <id>]
  openagents init [--kind <workflow|harness|rules|skill>] [--name <name>] [--dir <path>]
                  [--owner <owner>] [--title <title>] [--summary <text>]
                  [--tags <a,b,c>] [--runtimes <a,b,c>] [--license <spdx>]
                  [--version <semver>] [--force]
  openagents validate [dir]
  openagents publish

Options:
  -h, --help       Show this help
  -v, --version    Show the CLI version

Environment:
  OPENAGENTS_REGISTRY   Default registry URL (default: https://openagents-nu.vercel.app)

Runtimes: claude-code, cursor, codex, openai-agents, langgraph, generic

Examples:
  openagents add openagents/pr-reviewer
  openagents add openagents/pr-reviewer --runtime claude-code
  openagents search "code review"
  openagents info openagents/pr-reviewer
  openagents list
  openagents remove openagents/pr-reviewer
  openagents init --kind workflow --name my-workflow
  openagents validate ./catalog/openagents/pr-reviewer
`;

/** Options each command accepts, for unknown-flag detection ("did you mean"). Booleans included. */
const KNOWN_OPTIONS = {
  add: ["runtime", "registry", "dir"],
  search: ["registry", "json"],
  info: ["registry", "json"],
  list: ["dir", "json"],
  remove: ["dir", "runtime"],
  init: [
    "kind",
    "name",
    "dir",
    "owner",
    "title",
    "summary",
    "tags",
    "runtimes",
    "license",
    "version",
    "force",
  ],
  validate: [],
  publish: ["registry"],
};

/** Minimal argv parser: positional args land in `_`, `--flag value` and `--flag=value` land as named. */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      out.help = true;
    } else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          out[a.slice(2)] = next;
          i++;
        } else {
          out[a.slice(2)] = true;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** Levenshtein edit distance, for "did you mean" suggestions. */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function closestOption(unknown, known) {
  let best = null;
  let bestDist = Infinity;
  for (const opt of known) {
    const d = editDistance(unknown, opt);
    if (d < bestDist) {
      bestDist = d;
      best = opt;
    }
  }
  // Only suggest reasonably close matches.
  return best && bestDist <= Math.max(2, Math.ceil(unknown.length / 2)) ? best : null;
}

/** Validate `args` against `command`'s known options; returns an error message, or null if OK. */
function checkUnknownOptions(command, args) {
  const known = KNOWN_OPTIONS[command];
  if (!known) return null;
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") continue;
    if (known.includes(key)) continue;
    const suggestion = closestOption(key, known);
    return suggestion
      ? `unknown option --${key} (did you mean --${suggestion}?)`
      : `unknown option --${key}`;
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command) {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  if (command === "-h" || command === "--help") {
    console.log(HELP);
    return;
  }
  if (command === "-v" || command === "--version") {
    console.log(pkg.version);
    return;
  }

  const args = parseArgs(rest);

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (!(command in KNOWN_OPTIONS)) {
    console.error(`✗ unknown command: ${command}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  const optionError = checkUnknownOptions(command, args);
  if (optionError) {
    console.error(`✗ ${optionError}`);
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case "add": {
      const { run } = await import("../lib/commands/add.js");
      await run(args);
      break;
    }
    case "search": {
      const { run } = await import("../lib/commands/search.js");
      await run(args);
      break;
    }
    case "info": {
      const { run } = await import("../lib/commands/info.js");
      await run(args);
      break;
    }
    case "list": {
      const { run } = await import("../lib/commands/list.js");
      await run(args);
      break;
    }
    case "remove": {
      const { run } = await import("../lib/commands/remove.js");
      await run(args);
      break;
    }
    case "init": {
      const { run } = await import("../lib/commands/init.js");
      run(args);
      break;
    }
    case "validate": {
      const { run } = await import("../lib/commands/validate.js");
      run(args);
      break;
    }
    case "publish": {
      const { run } = await import("../lib/commands/publish.js");
      run(args);
      break;
    }
  }
}

// Only run when invoked directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(`✗ ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  });
}

export { parseArgs, checkUnknownOptions, closestOption, editDistance, KNOWN_OPTIONS, main };
