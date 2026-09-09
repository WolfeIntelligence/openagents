import fs from "node:fs";
import path from "node:path";

export const DEFAULT_REGISTRY = "https://openagents-nu.vercel.app";

export function registryUrl(flagValue) {
  return (flagValue || process.env.OPENAGENTS_REGISTRY || DEFAULT_REGISTRY).replace(/\/+$/, "");
}

/** Split "owner/name" into { owner, name }; throws a readable error otherwise. */
export function splitPackageRef(ref) {
  if (!ref || typeof ref !== "string" || !ref.includes("/")) {
    throw new Error(`expected a package reference like "owner/name", got: ${ref ?? "(nothing)"}`);
  }
  const [owner, ...rest] = ref.split("/");
  const name = rest.join("/");
  if (!owner || !name) {
    throw new Error(`expected a package reference like "owner/name", got: ${ref}`);
  }
  return { owner, name };
}

export function existsSync(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/** List all files under `dir` recursively, as paths relative to `dir` with forward slashes. */
export function listFilesRecursive(dir, base = dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Fetch JSON from `url`, throwing a readable error on non-2xx or non-JSON. */
export async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`could not reach ${url}: ${err.message}`);
  }
  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`GET ${url} -> HTTP ${res.status}${bodyText ? `\n${bodyText.slice(0, 500)}` : ""}`);
  }
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`GET ${url} did not return valid JSON: ${err.message}`);
  }
}

/** Render an array of objects as a simple padded table using the given columns. */
export function renderTable(rows, columns) {
  const widths = columns.map((c) =>
    Math.max(c.label.length, ...rows.map((r) => String(c.get(r) ?? "").length))
  );
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  const out = [line(columns.map((c) => c.label))];
  out.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    out.push(line(columns.map((c) => c.get(r) ?? "")));
  }
  return out.join("\n");
}
