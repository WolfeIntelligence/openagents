import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getToken } from "./auth.js";

export const DEFAULT_REGISTRY = "https://openagents-nu.vercel.app";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let cachedVersion;

/** The CLI's own version, from cli/package.json (cached after first read). */
export function cliVersion() {
  if (!cachedVersion) {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    cachedVersion = pkg.version;
  }
  return cachedVersion;
}

/** `User-Agent` header value sent on every registry request (G-A3). */
export function userAgent(runtime) {
  return `openagents-cli/${cliVersion()} (${runtime || "unknown"})`;
}

/** The `User-Agent` header object, ready to spread into a `fetch` `headers`. */
export function userAgentHeaders(runtime) {
  return { "User-Agent": userAgent(runtime) };
}

/**
 * `Authorization: Bearer <token>` header for `registry`, or `{}` if no token
 * is stored for it (and `OPENAGENTS_TOKEN` isn't set). Used by every
 * authenticated request (publish, `whoami`, paid downloads); other CLI
 * command modules should call this rather than reading `auth.js` directly.
 */
export function authHeaders(registry) {
  const token = getToken(registry);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function registryUrl(flagValue) {
  return (flagValue || process.env.OPENAGENTS_REGISTRY || DEFAULT_REGISTRY).replace(/\/+$/, "");
}

/**
 * Split "owner/name" or "owner/name@version" into { owner, name, version }
 * (`version` is undefined when no `@version` selector was given). Throws a
 * readable error for anything else.
 */
export function splitPackageRef(ref) {
  if (!ref || typeof ref !== "string") {
    throw new Error(`expected a package reference like "owner/name" or "owner/name@version", got: ${ref ?? "(nothing)"}`);
  }
  let rest = ref;
  let version;
  const at = rest.lastIndexOf("@");
  if (at > 0) {
    version = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  if (!rest.includes("/")) {
    throw new Error(`expected a package reference like "owner/name" or "owner/name@version", got: ${ref}`);
  }
  const [owner, ...parts] = rest.split("/");
  const name = parts.join("/");
  if (!owner || !name) {
    throw new Error(`expected a package reference like "owner/name" or "owner/name@version", got: ${ref}`);
  }
  return { owner, name, version };
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

/**
 * Build a readable Error from a non-2xx fetch Response, preferring the
 * server's JSON `{error, issues}` body over a raw dump. The error carries
 * `.status` and `.body` (the parsed JSON body, if any) for callers that want
 * to branch on the status code (e.g. 402 payment-required).
 */
export async function responseError(url, res, method = "GET") {
  let bodyText = "";
  let body = null;
  try {
    bodyText = await res.text();
    body = JSON.parse(bodyText);
  } catch {
    // not JSON; fall through with body === null
  }
  let message;
  if (body && typeof body.error === "string") {
    message = body.error;
    if (Array.isArray(body.issues) && body.issues.length) {
      message += `: ${body.issues.join("; ")}`;
    }
  } else {
    message = `${method} ${url} -> HTTP ${res.status}${bodyText ? `\n${bodyText.slice(0, 500)}` : ""}`;
  }
  if (res.status === 401 || res.status === 403) {
    message += `\nrun \`openagents login\` to authenticate.`;
  }
  const err = new Error(message);
  err.status = res.status;
  err.body = body;
  return err;
}

/**
 * Fetch JSON from `url`, throwing a readable error (see `responseError`) on
 * non-2xx or non-JSON. Sends the CLI's `User-Agent` header (pass `runtime`
 * so it can be included for registry analytics, G-A3) and, when a token is
 * stored for the target registry, an `Authorization: Bearer` header —
 * `registry` defaults to `url`'s origin, which is right for every call site
 * that builds `url` from `registryUrl()`.
 */
export async function fetchJson(url, { runtime, registry } = {}) {
  const reg = registry ?? originOf(url);
  let res;
  try {
    res = await fetch(url, { headers: { ...userAgentHeaders(runtime), ...authHeaders(reg) } });
  } catch (err) {
    throw new Error(`could not reach ${url}: ${err.message}`);
  }
  if (!res.ok) {
    throw await responseError(url, res, "GET");
  }
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`GET ${url} did not return valid JSON: ${err.message}`);
  }
}

/**
 * `GET /api/v1/me` with an explicit bearer `token` (not necessarily the one
 * stored for `registry` — used by `login` to verify a token before saving
 * it, and by `whoami` for the stored one). Returns `{ id, handle, name, via,
 * scopes }`; throws (see `responseError`) on a non-2xx response, notably 401
 * for an invalid/revoked token.
 */
export async function fetchMe(registry, token, { runtime } = {}) {
  const url = `${registry}/api/v1/me`;
  let res;
  try {
    res = await fetch(url, {
      headers: { ...userAgentHeaders(runtime), Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new Error(`could not reach ${url}: ${err.message}`);
  }
  if (!res.ok) {
    throw await responseError(url, res, "GET");
  }
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`GET ${url} did not return valid JSON: ${err.message}`);
  }
}

/** Format integer cents as a currency string, e.g. formatPrice(500, "usd") -> "$5.00". */
export function formatPrice(amountCents, currency = "usd") {
  const amount = (Number(amountCents) || 0) / 100;
  const cur = String(currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(amount);
  } catch {
    return `$${amount.toFixed(2)} ${cur}`;
  }
}

/** True if `child` is `parent` itself or a path underneath it. */
export function isPathInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
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
