// Bulk/incremental catalog export (GET /api/v1/catalog.ndjson) — see
// src/content/docs/api.md#get-apiv1catalogndjson.
//
// A mirror that wants the whole catalog today pages through /api/v1/packages,
// which costs one request per DEFAULT_PAGE_SIZE (24) packages. This module
// backs a route that instead streams every live/deprecated package as one
// JSON object per line, and accepts `?since=<ISO time>` so a mirror that
// already has a snapshot can ask for only what changed.

import type { CatalogExportEntry, Package } from "@/lib/types";

/** Builds one export line's fields from a full `Package` plus its tarball's
 *  digest (computed by the route — this module has no tarball/IO dependency,
 *  so it stays trivially unit-testable). */
export function toCatalogExportEntry(pkg: Package, downloadSha256: string): CatalogExportEntry {
  return {
    id: pkg.id,
    owner: pkg.owner,
    name: pkg.name,
    kind: pkg.manifest.kind,
    title: pkg.manifest.title,
    summary: pkg.manifest.summary,
    version: pkg.manifest.version,
    license: pkg.manifest.license,
    tags: pkg.manifest.tags,
    capabilities: pkg.manifest.capabilities,
    runtimes: pkg.manifest.runtimes,
    pricing: pkg.manifest.pricing,
    updatedAt: pkg.updatedAt,
    downloadSha256,
  };
}

export type ParsedSince = { ok: true; since?: Date } | { ok: false; error: string };

/** Parses `?since=<ISO time>`. Absent is valid (means "everything"); present
 *  but unparseable as a date is a 400, not a silently-ignored filter. */
export function parseSince(raw: string | null): ParsedSince {
  if (!raw) return { ok: true, since: undefined };
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    return { ok: false, error: `invalid since: ${raw} (expected an ISO 8601 date-time)` };
  }
  return { ok: true, since: new Date(ms) };
}

/** Items updated at or after `since` (inclusive). Inclusive rather than
 *  exclusive so a mirror that re-polls with the newest `updatedAt` it already
 *  stored sees that package again (a harmless re-fetch it can dedupe on id +
 *  version) instead of risking a skipped update when two packages publish in
 *  the same millisecond. `since` absent returns every item unfiltered. */
export function updatedSince<T extends { updatedAt: string }>(items: T[], since?: Date): T[] {
  if (!since) return items;
  const cutoff = since.getTime();
  return items.filter((item) => new Date(item.updatedAt).getTime() >= cutoff);
}
