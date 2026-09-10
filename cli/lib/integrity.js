// Tarball integrity (X6a / G-V4): sha256 the downloaded bytes, compare
// against the registry's `X-Checksum-Sha256` (or `ETag`) header when
// present, and format/parse the `integrity: "sha256-<hex>"` string recorded
// in the lockfile.

import { createHash } from "node:crypto";

/** sha256 hex digest of `buffer` (a Buffer or Uint8Array). */
export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Build the lockfile `integrity` string for a sha256 hex digest. */
export function toIntegrityString(hex) {
  return `sha256-${String(hex).toLowerCase()}`;
}

/** Extract the hex digest from an `integrity` string, or null if it isn't sha256-shaped. */
export function parseIntegrityString(integrity) {
  const m = /^sha256-([0-9a-f]{64})$/i.exec(String(integrity || ""));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Pull the expected sha256 hex digest out of a fetch Response's headers:
 * `X-Checksum-Sha256` first, falling back to a sha256-hex-shaped `ETag`
 * (quoted or not). Returns null if neither header is present or neither
 * value looks like a sha256 hex digest.
 *
 * `headers` may be a `Headers` instance or a plain `{ [name]: value }`
 * object (case-insensitive lookup either way).
 */
export function expectedChecksumFromHeaders(headers) {
  const get = (name) => {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return key ? headers[key] : null;
  };

  const direct = get("x-checksum-sha256");
  if (direct && /^[0-9a-f]{64}$/i.test(direct.trim())) {
    return direct.trim().toLowerCase();
  }
  const etag = get("etag");
  if (etag) {
    const m = /^"?([0-9a-f]{64})"?$/i.exec(etag.trim());
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Verify `actualHex` against `expectedHex` (case-insensitive). Throws a
 * clear error on mismatch. No-op when `expectedHex` is null/undefined (the
 * registry sent no checksum header) — the caller should still record
 * `actualHex` in the lockfile so a *later* reinstall of the same version can
 * be checked for tampering even without a header.
 */
export function verifyChecksum(actualHex, expectedHex, { label = "download" } = {}) {
  if (!expectedHex) return;
  if (String(actualHex).toLowerCase() !== String(expectedHex).toLowerCase()) {
    throw new Error(`integrity check failed for ${label}: expected sha256 ${expectedHex}, got ${actualHex}`);
  }
}
