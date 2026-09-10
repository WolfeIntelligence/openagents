// Semver parsing, comparison, and npm-style range satisfaction (X6a).
//
// Used to resolve `requires: ["owner/name@range", ...]` manifest entries and
// `openagents add owner/name@<version|range>` / `openagents outdated` /
// `openagents update`. Implements the practical subset of node-semver's
// range grammar described in npm's docs: exact versions, comparator
// operators (`>=`, `<=`, `>`, `<`, `=`) space-joined as AND, `||` as OR,
// `^` and `~` ranges, x-ranges (`1.x`, `1.2.*`, `*`), and hyphen ranges
// (`"1.2.3 - 2.3.4"`). No dependencies, no side effects — safe to unit test
// directly with `node:test`.
//
// Prerelease rule (per npm semantics): a version with a prerelease tag only
// satisfies a range if at least one comparator *in the same (AND) set*
// shares its [major, minor, patch] tuple and itself carries a prerelease
// tag. This is exactly node-semver's `testSet` behaviour and is what makes
// `1.2.4-beta` fail to satisfy `^1.2.3` while `1.2.3-beta.5` can satisfy
// `^1.2.3-beta.2`.

export class SemverError extends Error {
  constructor(version) {
    super(`invalid semantic version: "${version}"`);
    this.name = "SemverError";
  }
}

export class RangeError_ extends Error {
  constructor(range) {
    super(`invalid semver range: "${range}"`);
    this.name = "InvalidRangeError";
  }
}

const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const NUMERIC_IDENTIFIER_RE = /^(0|[1-9]\d*)$/;

/** Parses a full semver string, throwing `SemverError` if it does not conform to semver.org. */
export function parse(version) {
  const match = SEMVER_RE.exec(String(version).trim());
  if (!match) throw new SemverError(version);
  const [, majorStr, minorStr, patchStr, prereleaseStr, buildStr] = match;
  const prerelease = prereleaseStr
    ? prereleaseStr.split(".").map((id) => (NUMERIC_IDENTIFIER_RE.test(id) ? Number(id) : id))
    : [];
  const build = buildStr ? buildStr.split(".") : [];
  return { major: Number(majorStr), minor: Number(minorStr), patch: Number(patchStr), prerelease, build };
}

/** Like `parse`, but returns null instead of throwing. */
export function tryParse(version) {
  try {
    return parse(version);
  } catch {
    return null;
  }
}

/** True when `version` is a syntactically valid full semver string. */
export function valid(version) {
  return tryParse(version) !== null;
}

function compareIdentifier(a, b) {
  const aIsNum = typeof a === "number";
  const bIsNum = typeof b === "number";
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aIsNum && bIsNum) return a === b ? 0 : a < b ? -1 : 1;
  if (aIsNum && !bIsNum) return -1;
  if (!aIsNum && bIsNum) return 1;
  const aStr = String(a);
  const bStr = String(b);
  return aStr === bStr ? 0 : aStr < bStr ? -1 : 1;
}

/** -1 if a < b, 0 if equal precedence, 1 if a > b, per semver.org §11. Build metadata is ignored. */
export function compare(a, b) {
  const pa = typeof a === "string" ? parse(a) : a;
  const pb = typeof b === "string" ? parse(b) : b;

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  const aPre = pa.prerelease.length > 0;
  const bPre = pb.prerelease.length > 0;
  // A version with a prerelease has lower precedence than the same version without one.
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (!aPre && !bPre) return 0;

  const len = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const cmp = compareIdentifier(pa.prerelease[i], pb.prerelease[i]);
    if (cmp !== 0) return cmp;
  }
  if (pa.prerelease.length !== pb.prerelease.length) {
    return pa.prerelease.length < pb.prerelease.length ? -1 : 1;
  }
  return 0;
}

export function gt(a, b) {
  return compare(a, b) > 0;
}
export function lt(a, b) {
  return compare(a, b) < 0;
}
export function eq(a, b) {
  return compare(a, b) === 0;
}
export function gte(a, b) {
  return compare(a, b) >= 0;
}
export function lte(a, b) {
  return compare(a, b) <= 0;
}

function mkVersion(major, minor, patch, prerelease = []) {
  return { major, minor, patch, prerelease, build: [] };
}

// A single token in a comparator set, e.g. "1", "1.2", "1.2.3", "1.2.x",
// "*", with an optional prerelease/build suffix on the (fully specified)
// patch component. Missing / x / X / * components come back as `null`.
function parseToken(token) {
  const m =
    /^([0-9]+|[xX*])(?:\.([0-9]+|[xX*]))?(?:\.([0-9]+|[xX*]))?(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/.exec(
      String(token).trim()
    );
  if (!m) return null;
  const conv = (s) => (s === undefined || s === "x" || s === "X" || s === "*" ? null : Number(s));
  const major = conv(m[1]);
  const minor = m[2] === undefined ? null : conv(m[2]);
  const patch = m[3] === undefined ? null : conv(m[3]);
  const prereleaseStr = m[4];
  const prerelease = prereleaseStr
    ? prereleaseStr.split(".").map((id) => (NUMERIC_IDENTIFIER_RE.test(id) ? Number(id) : id))
    : [];
  return { major, minor, patch, prerelease };
}

/** A comparator that matches every version (subject to the prerelease rule). */
const ANY = { op: "*" };

function expandCaret(p) {
  const { major, minor, patch, prerelease } = p;
  if (major === null) return [ANY];
  const lowMinor = minor === null ? 0 : minor;
  const lowPatch = patch === null ? 0 : patch;
  const lower = mkVersion(major, lowMinor, lowPatch, patch !== null ? prerelease : []);
  let upper;
  if (major > 0) {
    upper = mkVersion(major + 1, 0, 0, [0]);
  } else if (minor === null) {
    upper = mkVersion(1, 0, 0, [0]);
  } else if (minor > 0) {
    upper = mkVersion(0, minor + 1, 0, [0]);
  } else if (patch === null) {
    upper = mkVersion(0, 1, 0, [0]);
  } else {
    upper = mkVersion(0, 0, patch + 1, [0]);
  }
  return [
    { op: ">=", version: lower },
    { op: "<", version: upper },
  ];
}

function expandTilde(p) {
  const { major, minor, patch, prerelease } = p;
  if (major === null) return [ANY];
  const lowMinor = minor === null ? 0 : minor;
  const lowPatch = patch === null ? 0 : patch;
  const lower = mkVersion(major, lowMinor, lowPatch, patch !== null ? prerelease : []);
  const upper = minor === null ? mkVersion(major + 1, 0, 0, [0]) : mkVersion(major, minor + 1, 0, [0]);
  return [
    { op: ">=", version: lower },
    { op: "<", version: upper },
  ];
}

function expandXRange(p) {
  const { major, minor, patch, prerelease } = p;
  if (major === null) return [ANY];
  if (minor === null) {
    return [
      { op: ">=", version: mkVersion(major, 0, 0) },
      { op: "<", version: mkVersion(major + 1, 0, 0, [0]) },
    ];
  }
  if (patch === null) {
    return [
      { op: ">=", version: mkVersion(major, minor, 0) },
      { op: "<", version: mkVersion(major, minor + 1, 0, [0]) },
    ];
  }
  // A fully specified version with no operator is an exact match; anchor
  // both bounds to it (with its own prerelease, if any) so the prerelease
  // rule can recognise it.
  const v = mkVersion(major, minor, patch, prerelease);
  return [
    { op: ">=", version: v },
    { op: "<=", version: v },
  ];
}

function expandOperatorToken(op, verStr) {
  const p = parseToken(verStr);
  if (!p || p.major === null) throw new RangeError_(`${op}${verStr}`);
  const major = p.major;
  const minor = p.minor === null ? 0 : p.minor;
  const patch = p.patch === null ? 0 : p.patch;
  return [{ op, version: mkVersion(major, minor, patch, p.prerelease) }];
}

function expandHyphen(fromTok, toTok) {
  const from = parseToken(fromTok);
  const to = parseToken(toTok);
  if (!from || !to || from.major === null || to.major === null) {
    throw new RangeError_(`${fromTok} - ${toTok}`);
  }
  const lower = mkVersion(
    from.major,
    from.minor === null ? 0 : from.minor,
    from.patch === null ? 0 : from.patch,
    from.patch !== null ? from.prerelease : []
  );
  let upper;
  if (to.minor === null) {
    upper = { op: "<", version: mkVersion(to.major + 1, 0, 0, [0]) };
  } else if (to.patch === null) {
    upper = { op: "<", version: mkVersion(to.major, to.minor + 1, 0, [0]) };
  } else {
    upper = { op: "<=", version: mkVersion(to.major, to.minor, to.patch, to.prerelease) };
  }
  return [{ op: ">=", version: lower }, upper];
}

const OPERATOR_RE = /^(>=|<=|>|<|=)(.+)$/;

function tokenToComparators(token) {
  const opMatch = OPERATOR_RE.exec(token);
  if (opMatch) {
    return expandOperatorToken(opMatch[1], opMatch[2]);
  }
  if (token.startsWith("^")) {
    const p = parseToken(token.slice(1));
    if (!p) throw new RangeError_(token);
    return expandCaret(p);
  }
  if (token.startsWith("~")) {
    const p = parseToken(token.slice(1));
    if (!p) throw new RangeError_(token);
    return expandTilde(p);
  }
  const p = parseToken(token);
  if (!p) throw new RangeError_(token);
  return expandXRange(p);
}

const HYPHEN_RE = /^(\S+)\s+-\s+(\S+)$/;

function parseComparatorSet(branch) {
  const trimmed = branch.trim();
  if (trimmed === "") return [ANY];
  const hyphenMatch = HYPHEN_RE.exec(trimmed);
  if (hyphenMatch) {
    return expandHyphen(hyphenMatch[1], hyphenMatch[2]);
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const comparators = [];
  for (const token of tokens) {
    comparators.push(...tokenToComparators(token));
  }
  return comparators;
}

/** Parse a full range string into an array of comparator sets (OR of ANDs). Throws `RangeError_` on malformed input. */
export function parseRange(range) {
  const trimmed = String(range ?? "").trim();
  const branches = trimmed === "" ? ["*"] : trimmed.split("||");
  return branches.map(parseComparatorSet);
}

/** Like `parseRange`, but returns null instead of throwing. */
export function tryParseRange(range) {
  try {
    return parseRange(range);
  } catch {
    return null;
  }
}

function satisfiesComparator(version, c) {
  if (c.op === "*") return true;
  const cmp = compare(version, c.version);
  switch (c.op) {
    case ">=":
      return cmp >= 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
    default:
      return false;
  }
}

function setAllowsPrerelease(set, version) {
  for (const c of set) {
    if (c.op === "*") continue;
    if (
      c.version.prerelease.length > 0 &&
      c.version.major === version.major &&
      c.version.minor === version.minor &&
      c.version.patch === version.patch
    ) {
      return true;
    }
  }
  return false;
}

function satisfiesSet(version, set) {
  if (version.prerelease.length > 0 && !setAllowsPrerelease(set, version)) return false;
  return set.every((c) => satisfiesComparator(version, c));
}

/** True if `version` satisfies `range` (npm-style range syntax, see module docs). */
export function satisfies(version, range) {
  const v = typeof version === "string" ? tryParse(version) : version;
  if (!v) return false;
  const sets = tryParseRange(range);
  if (!sets) return false;
  return sets.some((set) => satisfiesSet(v, set));
}

/** The highest version in `versions` that satisfies `range`, or null if none does. */
export function maxSatisfying(versions, range) {
  let best = null;
  for (const version of versions) {
    if (!valid(version)) continue;
    if (!satisfies(version, range)) continue;
    if (best === null || gt(version, best)) best = version;
  }
  return best;
}
