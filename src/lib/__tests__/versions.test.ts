// Unit tests for the versioned-downloads workstream (S4/G-V1/G-V4).
//
// `listVersions`/`getPackageVersion`/`getFileAtVersion` talk to Postgres via
// `getDb()` directly, the way `catalog/db.ts` does — there's no fake-DB seam
// to test them against without reimplementing Drizzle, so per the task this
// file sticks to the pure, dependency-free helpers: the semver-based version
// sort, and the tarball module's filename/header/ETag/digest-determinism
// helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sortVersionsDesc } from "../catalog/versions";
import {
  etagMatches,
  packageTarballWithDigest,
  tarballFilename,
  tarballHeaders,
} from "../tarball";
import type { Manifest, Package, PackageFile, PackageVersion } from "../types";

function pv(version: string, publishedAt: string): PackageVersion {
  return { version, publishedAt };
}

test("sortVersionsDesc: orders by semver precedence, not string/publish order", () => {
  const versions = [
    pv("1.9.0", "2026-01-01T00:00:00.000Z"),
    pv("1.10.0", "2026-02-01T00:00:00.000Z"),
    pv("2.0.0", "2025-12-01T00:00:00.000Z"), // published earliest, but highest semver
    pv("1.2.0", "2026-03-01T00:00:00.000Z"), // published latest, but lowest semver
  ];
  assert.deepEqual(
    sortVersionsDesc(versions).map((v) => v.version),
    ["2.0.0", "1.10.0", "1.9.0", "1.2.0"]
  );
});

test("sortVersionsDesc: does not mutate its input and falls back to publishedAt for unparsable versions", () => {
  const versions = [pv("not-semver-a", "2026-01-01T00:00:00.000Z"), pv("not-semver-b", "2026-02-01T00:00:00.000Z")];
  const original = [...versions];
  const sorted = sortVersionsDesc(versions);
  assert.deepEqual(versions, original); // input untouched
  assert.deepEqual(
    sorted.map((v) => v.version),
    ["not-semver-b", "not-semver-a"] // newer publishedAt first
  );
});

test("tarballFilename: <owner>-<name>-<version>.tgz", () => {
  assert.equal(tarballFilename("openagents", "pr-reviewer", "1.2.0"), "openagents-pr-reviewer-1.2.0.tgz");
});

test("tarballHeaders: builds Content-Disposition, ETag and X-Checksum-Sha256 from the digest", () => {
  const headers = tarballHeaders({
    owner: "openagents",
    name: "pr-reviewer",
    version: "1.2.0",
    sha256: "deadbeef",
    contentLength: 42,
    cache: "immutable",
  }) as Record<string, string>;
  assert.equal(headers["Content-Disposition"], 'attachment; filename="openagents-pr-reviewer-1.2.0.tgz"');
  assert.equal(headers["Content-Length"], "42");
  assert.equal(headers["ETag"], '"deadbeef"');
  assert.equal(headers["X-Checksum-Sha256"], "deadbeef");
  assert.equal(headers["Cache-Control"], "public, max-age=31536000, immutable");
});

test("tarballHeaders: cache policy for free 'latest' vs paid", () => {
  const base = { owner: "o", name: "n", version: "1.0.0", sha256: "abc", contentLength: 1 };
  assert.equal(
    (tarballHeaders({ ...base, cache: "short" }) as Record<string, string>)["Cache-Control"],
    "public, max-age=300"
  );
  assert.equal(
    (tarballHeaders({ ...base, cache: "private" }) as Record<string, string>)["Cache-Control"],
    "private, no-store"
  );
});

test("etagMatches: quoted match, weak match, wildcard, list, and non-match", () => {
  assert.equal(etagMatches('"abc123"', "abc123"), true);
  assert.equal(etagMatches('W/"abc123"', "abc123"), true);
  assert.equal(etagMatches("*", "abc123"), true);
  assert.equal(etagMatches('"zzz", "abc123"', "abc123"), true);
  assert.equal(etagMatches('"zzz"', "abc123"), false);
  assert.equal(etagMatches(null, "abc123"), false);
  assert.equal(etagMatches(undefined, "abc123"), false);
});

// ---------------------------------------------------------------------------
// Deterministic tarball digest (G-V4): the same package content must always
// produce the same gzip bytes and therefore the same sha256, so it's usable
// as a stable ETag/checksum. Before this, tar-stream's default per-entry
// mtime (`new Date()`) made every build's gzip bytes different even for
// byte-identical file content.
// ---------------------------------------------------------------------------

function fakeManifest(): Manifest {
  return {
    schema: 1,
    name: "demo",
    owner: "acme",
    version: "1.0.0",
    kind: "skill",
    title: "Demo",
    summary: "A demo package.",
    license: "MIT",
    tags: [],
    runtimes: ["generic"],
    pricing: { model: "free", amountCents: 0, currency: "usd" },
    entry: "SKILL.md",
    files: ["SKILL.md", "lib/helper.md"],
    inputs: [],
    requires: [],
  };
}

function fakePackage(): Package {
  const manifest = fakeManifest();
  return {
    id: "acme/demo",
    owner: "acme",
    name: "demo",
    manifest,
    readme: "# Demo",
    files: [],
    versions: [],
    stats: { downloads: 0, stars: 0 },
    featured: false,
    status: "live",
    source: "seed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const FAKE_CONTENTS: Record<string, string> = {
  "openagent.yaml": "schema: 1\nname: demo\n",
  "README.md": "# Demo",
  "SKILL.md": "# Skill entry",
  "lib/helper.md": "# Helper",
};

async function getFakeFile(path: string): Promise<PackageFile | null> {
  const content = FAKE_CONTENTS[path];
  if (content === undefined) return null;
  return { path, size: Buffer.byteLength(content, "utf8"), content };
}

test("packageTarballWithDigest: identical input produces identical bytes and sha256", async () => {
  const pkg = fakePackage();
  const a = await packageTarballWithDigest(pkg, getFakeFile);
  // A small real-world delay, so a `new Date()`-based mtime (the original bug)
  // would reliably produce different bytes/digest on the second build.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const b = await packageTarballWithDigest(pkg, getFakeFile);

  assert.equal(a.sha256, b.sha256);
  assert.ok(a.buffer.equals(b.buffer));
  assert.equal(a.sha256.length, 64); // hex sha256
});

test("packageTarballWithDigest: file set order does not affect the digest", async () => {
  const pkg = fakePackage();
  pkg.manifest = { ...pkg.manifest, files: ["lib/helper.md", "SKILL.md"] }; // reversed
  const reordered = await packageTarballWithDigest(pkg, getFakeFile);
  const original = await packageTarballWithDigest(fakePackage(), getFakeFile);
  assert.equal(reordered.sha256, original.sha256);
});
