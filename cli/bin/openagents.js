#!/usr/bin/env node
// OpenAgents CLI — install, search, and scaffold agentic workflows/harnesses/
// rules/skills from the OpenAgents marketplace.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

const HELP = `openagents ${pkg.version} — CLI for the OpenAgents marketplace

Usage:
  openagents add <owner/name> [--runtime <id>] [--registry <url>] [--dir <path>]
  openagents search <query> [--registry <url>]
  openagents info <owner/name> [--registry <url>]
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
  OPENAGENTS_REGISTRY   Default registry URL (default: https://openagents.vercel.app)

Runtimes: claude-code, cursor, codex, openai-agents, langgraph, generic

Examples:
  openagents add openagents/pr-reviewer
  openagents add openagents/pr-reviewer --runtime claude-code
  openagents search "code review"
  openagents info openagents/pr-reviewer
  openagents init --kind workflow --name my-workflow
  openagents validate ./catalog/openagents/pr-reviewer
`;

/** Minimal argv parser: positional args land in `_`, `--flag value` and `--flag=value` land as named. */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      out.help = true;
    } else if (a === "-v" || a === "--version") {
      out.version = true;
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

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);
  const args = parseArgs(rest);

  if (!command || command === "-h" || command === "--help") {
    console.log(HELP);
    return;
  }
  if (command === "-v" || command === "--version") {
    console.log(pkg.version);
    return;
  }
  if (args.help) {
    console.log(HELP);
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
    default:
      console.error(`✗ unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`✗ ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
