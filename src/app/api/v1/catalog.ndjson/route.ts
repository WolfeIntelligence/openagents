import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { parseSince, toCatalogExportEntry, updatedSince } from "@/lib/catalogExport";
import { CATALOG_ALL_LIMIT } from "@/lib/types";
import { error, preflight, withCors } from "@/lib/api";
import { packageTarballWithDigest } from "@/lib/tarball";

export const runtime = "nodejs";

// GET /api/v1/catalog.ndjson?since=<ISO time> — every live/deprecated package
// (same visibility as /api/v1/packages) as one JSON object per line: id,
// owner, name, kind, title, summary, version, license, tags, runtimes,
// pricing, updatedAt, downloadSha256 (see CatalogExportEntry in
// src/lib/types.ts). `since` is optional and, when set, only returns packages
// updated at or after that time — a mirror does one full pull, remembers the
// newest updatedAt it saw, and re-polls with that as `since` instead of
// paging /api/v1/packages one page at a time.
export async function GET(request: NextRequest) {
  const parsedSince = parseSince(request.nextUrl.searchParams.get("since"));
  if (!parsedSince.ok) return error(400, parsedSince.error);

  const catalog = await getCatalog();
  const { items } = await catalog.list({ limit: CATALOG_ALL_LIMIT, sort: "updated" });
  const matching = updatedSince(items, parsedSince.since)
    .slice()
    // Oldest-first: a mirror reading the stream in order can bump its "since"
    // cursor to the last line it successfully applied and resume there if the
    // connection drops partway through.
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const summary of matching) {
        try {
          const pkg = await catalog.get(summary.owner, summary.name);
          if (!pkg) continue; // raced with a delete/unlist between list() and get()
          const { sha256 } = await packageTarballWithDigest(pkg, (path) =>
            catalog.getFile(summary.owner, summary.name, path)
          );
          const line = JSON.stringify(toCatalogExportEntry(pkg, sha256));
          controller.enqueue(encoder.encode(line + "\n"));
        } catch (err) {
          // One bad package (a broken file reference, an IO error building its
          // tarball) should never take down the whole export — skip it and keep
          // streaming the rest, the same fault-tolerance the seed catalog and
          // catalog/db.ts already apply elsewhere.
          console.error(`[catalog.ndjson] skipping ${summary.owner}/${summary.name}:`, err);
        }
      }
      controller.close();
    },
  });

  return withCors(
    new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        // Every request recomputes the set from the live catalog (and re-hashes
        // each tarball), so there's nothing here a shared/browser cache should
        // hold onto — same reasoning as the "private" tarball cache policy.
        "Cache-Control": "no-store",
      },
    })
  );
}

export async function OPTIONS() {
  return preflight();
}
