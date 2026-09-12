import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_BIN = path.join(REPO_ROOT, "cli", "bin", "openagents.js");

function runCli(args: string[], cwd?: string) {
  return execFileAsync("node", [CLI_BIN, ...args], { cwd: cwd ?? REPO_ROOT });
}

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("add installs a package, writes a SKILL.md shim and a lockfile", async ({ baseURL }) => {
  const dir = mkTmpDir("oa-e2e-add-");
  try {
    const { stdout } = await runCli([
      "add",
      "openagents/pr-reviewer",
      "--runtime",
      "claude-code",
      "--registry",
      baseURL!,
      "--dir",
      dir,
    ]);
    expect(stdout).toContain("installed openagents/pr-reviewer");

    const skillPath = path.join(dir, ".claude", "skills", "pr-reviewer", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const skillContent = fs.readFileSync(skillPath, "utf8");
    expect(skillContent.trimStart().startsWith("---")).toBe(true);
    expect(skillContent).toContain("name: pr-reviewer");

    const lockfilePath = path.join(dir, ".openagents", "installed.json");
    expect(fs.existsSync(lockfilePath)).toBe(true);
    const lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
    expect(lockfile.packages["openagents/pr-reviewer"]).toBeTruthy();
    expect(lockfile.packages["openagents/pr-reviewer"].version).toBe("1.2.0");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("search --json returns the package as an item", async ({ baseURL }) => {
  const { stdout } = await runCli(["search", "code review", "--registry", baseURL!, "--json"]);
  const data = JSON.parse(stdout);
  const items = Array.isArray(data) ? data : data.items;
  expect(items.some((i: { name: string }) => i.name === "pr-reviewer")).toBe(true);
});

test("info --json returns the full manifest", async ({ baseURL }) => {
  const { stdout } = await runCli(["info", "openagents/pr-reviewer", "--registry", baseURL!, "--json"]);
  const pkg = JSON.parse(stdout);
  expect(pkg.manifest.name).toBe("pr-reviewer");
  expect(pkg.manifest.version).toBe("1.2.0");
});

test("validate succeeds on a seed package", async () => {
  const { stdout } = await runCli(["validate", "catalog/openagents/pr-reviewer"]);
  expect(stdout).toContain("is valid");
});

test("init --version round-trips through validate", async () => {
  const dir = mkTmpDir("oa-e2e-init-");
  try {
    const { stdout: initOut } = await runCli([
      "init",
      "--kind",
      "workflow",
      "--name",
      "test-pkg",
      "--version",
      "2.3.1",
      "--dir",
      dir,
    ]);
    expect(initOut).toContain("scaffolded");

    const { stdout: validateOut } = await runCli(["validate", dir]);
    expect(validateOut).toContain("test-pkg@2.3.1 is valid");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
