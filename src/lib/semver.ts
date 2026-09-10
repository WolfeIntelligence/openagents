// Minimal semver parser and comparator (https://semver.org, precedence per §11).
//
// Used by publish.ts to enforce that a new version is strictly greater than a
// package's current latestVersion, and to detect an already-published version.
// This module has no dependencies and no side effects — safe to unit test
// directly with `node:test`.

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers, numeric ones already converted to number. Empty for a release version. */
  prerelease: (string | number)[];
  /** Dot-separated build metadata identifiers. Ignored for comparison. */
  build: string[];
}

export class SemverError extends Error {
  constructor(version: string) {
    super(`invalid semantic version: "${version}"`);
    this.name = "SemverError";
  }
}

// Official semver.org grammar: numeric identifiers (major/minor/patch, and any
// all-digit prerelease identifier) may not have leading zeros.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const NUMERIC_IDENTIFIER_RE = /^(0|[1-9]\d*)$/;

/** Parses a semver string, throwing `SemverError` if it does not conform to semver.org. */
export function parseSemver(version: string): ParsedSemver {
  const match = SEMVER_RE.exec(version.trim());
  if (!match) throw new SemverError(version);

  const [, majorStr, minorStr, patchStr, prereleaseStr, buildStr] = match;
  const prerelease = prereleaseStr
    ? prereleaseStr.split(".").map((id) => (NUMERIC_IDENTIFIER_RE.test(id) ? Number(id) : id))
    : [];
  const build = buildStr ? buildStr.split(".") : [];

  return {
    major: Number(majorStr),
    minor: Number(minorStr),
    patch: Number(patchStr),
    prerelease,
    build,
  };
}

function compareIdentifier(a: string | number, b: string | number): number {
  const aIsNum = typeof a === "number";
  const bIsNum = typeof b === "number";
  // Rule: numeric identifiers always have lower precedence than alphanumeric ones.
  if (aIsNum && bIsNum) return a === b ? 0 : a < b ? -1 : 1;
  if (aIsNum && !bIsNum) return -1;
  if (!aIsNum && bIsNum) return 1;
  const aStr = String(a);
  const bStr = String(b);
  return aStr === bStr ? 0 : aStr < bStr ? -1 : 1;
}

/** -1 if a < b, 0 if equal precedence, 1 if a > b, per semver.org §11. Build metadata is ignored. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  const aIsPrerelease = pa.prerelease.length > 0;
  const bIsPrerelease = pb.prerelease.length > 0;
  // A version with a prerelease has lower precedence than the same version without one.
  if (aIsPrerelease && !bIsPrerelease) return -1;
  if (!aIsPrerelease && bIsPrerelease) return 1;
  if (!aIsPrerelease && !bIsPrerelease) return 0;

  const len = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const cmp = compareIdentifier(pa.prerelease[i], pb.prerelease[i]);
    if (cmp !== 0) return cmp;
  }
  // All shared identifiers are equal — the longer prerelease has higher precedence.
  if (pa.prerelease.length !== pb.prerelease.length) {
    return pa.prerelease.length < pb.prerelease.length ? -1 : 1;
  }
  return 0;
}

/** True when `a` is strictly greater precedence than `b`. */
export function isGreater(a: string, b: string): boolean {
  return compareSemver(a, b) > 0;
}
