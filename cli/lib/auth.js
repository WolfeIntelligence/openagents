// Persistent token store for `openagents login` / `logout` / `whoami` and
// for authenticated requests (publish, paid downloads).
//
// File: $OPENAGENTS_CONFIG_DIR/config.json, or ~/.config/openagents/config.json
// (%APPDATA%\openagents\config.json on Windows). Shape:
//
//   { "registries": { "<registry url>": { token, handle, savedAt } } }
//
// Multiple registries can each have their own token (e.g. a self-hosted
// registry alongside the default one). `OPENAGENTS_TOKEN` overrides whatever
// is stored on disk for every registry (G-T2) — handy for CI.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Directory holding the CLI's persistent config. */
export function configDir() {
  if (process.env.OPENAGENTS_CONFIG_DIR) return process.env.OPENAGENTS_CONFIG_DIR;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "openagents");
  }
  return path.join(os.homedir(), ".config", "openagents");
}

export function configPath() {
  return path.join(configDir(), "config.json");
}

/** Read the config file, or `{ registries: {} }` if missing/unreadable/malformed. */
function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && data.registries && typeof data.registries === "object") {
      return data;
    }
  } catch {
    // missing, unreadable, or malformed — treat as empty
  }
  return { registries: {} };
}

function writeConfig(data) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = configPath();
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
  try {
    // Best-effort: not all filesystems (notably Windows/FAT/exFAT) honor
    // POSIX modes, so a failure here is not fatal.
    fs.chmodSync(p, 0o600);
  } catch {
    // unsupported on this platform — ignore
  }
}

/**
 * The stored auth token for `registry`, or undefined. `OPENAGENTS_TOKEN`
 * (when set) overrides the file entirely, for every registry.
 */
export function getToken(registry) {
  if (process.env.OPENAGENTS_TOKEN) return process.env.OPENAGENTS_TOKEN;
  const data = readConfig();
  return data.registries[registry]?.token;
}

/** The full stored record ({ token, handle, savedAt }) for `registry`, or undefined. */
export function getRegistryRecord(registry) {
  return readConfig().registries[registry];
}

/** Store `token` for `registry`, replacing any existing entry. */
export function setToken(registry, token, { handle } = {}) {
  const data = readConfig();
  data.registries[registry] = { token, handle, savedAt: new Date().toISOString() };
  writeConfig(data);
}

/** Remove the stored token for `registry`. Returns true if one was removed. */
export function clearToken(registry) {
  const data = readConfig();
  if (!(registry in data.registries)) return false;
  delete data.registries[registry];
  writeConfig(data);
  return true;
}
