// Transitive dependency resolution for `manifest.requires` (X6a / S5).
//
// Builds an install plan `[{ id, version, reason, manifest, downloadUrl,
// status, deprecation, requestedRange, cached }]` by walking a package's
// `requires: ["owner/name@range", ...]` depth-first, fetching each
// dependency's manifest from the registry, detecting cycles, and reporting
// range conflicts between two packages that require the same dependency at
// incompatible versions. A dependency already recorded in the lockfile at a
// version that satisfies the requested range is reused rather than
// re-resolved.
//
// Registry contract (docs/AUDIT-2026-09.md S5 / G-V3, implemented server side
// alongside this work):
//   GET /api/v1/packages/{o}/{n}                    -> { manifest, latestVersion, status, deprecation? }
//   GET /api/v1/packages/{o}/{n}/versions            -> { versions: [{ version, publishedAt, changelog? }] }
//   GET /api/v1/packages/{o}/{n}/versions/{v}        -> same shape as the package-detail endpoint, pinned to {v}
//   GET /api/v1/packages/{o}/{n}/versions/{v}/download -> tarball (X-Checksum-Sha256 / ETag headers)
// The plain (non-versioned) endpoints are live today; the `/versions*`
// endpoints are landing in another workstream, so this module is written
// against the contract and unit-tested with a mocked `fetch` rather than
// against production.

import { fetchJson, splitPackageRef } from "./util.js";
import { parse as parseSemver, satisfies, maxSatisfying } from "./semver.js";
import { readLockfile } from "./lockfile.js";

const KNOWN_STATUSES = new Set(["live", "unlisted", "deprecated"]);

function isExactVersion(v) {
  try {
    parseSemver(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve `owner/name` at `range` (a pinned version, an npm-style range, or
 * undefined for "latest") to `{ manifest, version, status, deprecation,
 * downloadUrl }`.
 */
export async function fetchResolvedPackage({ owner, name, range, registry, runtime }) {
  const base = `${registry}/api/v1/packages/${owner}/${name}`;

  if (!range) {
    const detail = await fetchJson(base, { runtime });
    const manifest = detail.manifest || detail;
    return {
      manifest,
      version: manifest.version,
      status: detail.status,
      deprecation: detail.deprecation,
      downloadUrl: detail.downloadUrl || `${base}/download`,
    };
  }

  if (isExactVersion(range)) {
    const detail = await fetchJson(`${base}/versions/${range}`, { runtime });
    const manifest = detail.manifest || detail;
    return {
      manifest,
      version: manifest.version || range,
      status: detail.status,
      deprecation: detail.deprecation,
      downloadUrl: detail.downloadUrl || `${base}/versions/${range}/download`,
    };
  }

  const versionsRes = await fetchJson(`${base}/versions`, { runtime });
  const versions = (versionsRes.versions || []).map((v) => v.version);
  const picked = maxSatisfying(versions, range);
  if (!picked) {
    throw new Error(`no published version of ${owner}/${name} satisfies "${range}"`);
  }
  const detail = await fetchJson(`${base}/versions/${picked}`, { runtime });
  const manifest = detail.manifest || detail;
  return {
    manifest,
    version: manifest.version || picked,
    status: detail.status,
    deprecation: detail.deprecation,
    downloadUrl: detail.downloadUrl || `${base}/versions/${picked}/download`,
  };
}

function describeRequirer(parent, id, range) {
  return parent ? `${parent.id}@${parent.version} needs ${id}@${range}` : `you requested ${id}@${range || "latest"}`;
}

/**
 * Build the transitive install plan for `owner/name@range`, depth-first,
 * with cycle detection and range-conflict reporting. Set `noDeps` to only
 * resolve the root package. `plan[0]` is always the root.
 */
export async function buildPlan({ owner, name, range, registry, runtime, projectDir, noDeps = false, log = console.log, warn = console.warn }) {
  const plan = [];
  const visited = new Map(); // id -> { version, range, parent }
  const lock = readLockfile(projectDir);

  async function visit(id, depRange, parent, pathStack) {
    if (pathStack.includes(id)) {
      throw new Error(`dependency cycle detected: ${[...pathStack, id].join(" -> ")}`);
    }

    if (visited.has(id)) {
      const existing = visited.get(id);
      if (depRange && !satisfies(existing.version, depRange)) {
        throw new Error(
          `dependency version conflict: ${describeRequirer(existing.parent, id, existing.range)}, but ${describeRequirer(
            parent,
            id,
            depRange
          )}`
        );
      }
      return;
    }

    const reason = parent ? `required by ${parent.id}@${parent.version}` : "requested";
    const [depOwner, depName] = id.split("/");

    const lockEntry = lock.packages[id];
    if (lockEntry && lockEntry.version && (!depRange || satisfies(lockEntry.version, depRange))) {
      visited.set(id, { version: lockEntry.version, range: depRange, parent });
      plan.push({ id, version: lockEntry.version, reason, cached: true, requestedRange: depRange });
      log(`using cached ${id}@${lockEntry.version}`);
      return;
    }

    log(`Fetching ${id}${depRange ? `@${depRange}` : ""} from ${registry} ...`);
    const resolved = await fetchResolvedPackage({ owner: depOwner, name: depName, range: depRange, registry, runtime });

    if (resolved.status === "pending") {
      throw new Error(`${id}@${resolved.version} is pending review and cannot be installed yet`);
    }
    if (resolved.status && !KNOWN_STATUSES.has(resolved.status)) {
      throw new Error(`${id}@${resolved.version} has unknown status "${resolved.status}"; refusing to install`);
    }
    if (resolved.status === "deprecated") {
      const msg = resolved.deprecation?.message ? ` — ${resolved.deprecation.message}` : "";
      const repl = resolved.deprecation?.replacementId ? ` (see ${resolved.deprecation.replacementId})` : "";
      warn(`⚠ ${id}@${resolved.version} is deprecated${msg}${repl}`);
    }

    visited.set(id, { version: resolved.version, range: depRange, parent });
    plan.push({
      id,
      version: resolved.version,
      reason,
      manifest: resolved.manifest,
      downloadUrl: resolved.downloadUrl,
      status: resolved.status,
      deprecation: resolved.deprecation,
      requestedRange: depRange,
    });

    if (noDeps) return;
    const requires = Array.isArray(resolved.manifest?.requires) ? resolved.manifest.requires : [];
    for (const dep of requires) {
      const { owner: dOwner, name: dName, version: dRange } = splitPackageRef(dep);
      await visit(`${dOwner}/${dName}`, dRange, { id, version: resolved.version }, [...pathStack, id]);
    }
  }

  await visit(`${owner}/${name}`, range, null, []);
  return plan;
}

/** Render a plan (as returned by `buildPlan`) as printable lines. */
export function formatPlan(plan) {
  return plan.map((p) => `  ${p.id}@${p.version}${p.cached ? " (cached)" : ""}  — ${p.reason}`).join("\n");
}
