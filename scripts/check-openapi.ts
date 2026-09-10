// Walks every src/app/api/**/route.ts, normalizes its file path to a URL path
// template, and fails if that path isn't a key in public/openapi.json's `paths`.
// This is a floor, not a ceiling: it catches "shipped a route, forgot the spec"
// (api.md/openapi.json drifting from the actual routes — G-O7 in
// docs/AUDIT-2026-09.md), not the reverse. openapi.json documents the full
// batch-2 target contract, so it's expected to list paths with no route file yet
// while other workstreams land them — this script only ever complains about an
// existing route with no matching spec entry, never the other way around.
//
// Run with: npx tsx scripts/check-openapi.ts

import fs from "node:fs";
import path from "node:path";

const API_ROOT = path.join(process.cwd(), "src", "app", "api");
const SPEC_PATH = path.join(process.cwd(), "public", "openapi.json");

function listRouteFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listRouteFiles(full, out);
    } else if (entry.isFile() && entry.name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/**
 * `src/app/api/v1/packages/[owner]/[name]/route.ts`
 *   -> `/api/v1/packages/{owner}/{name}`
 *
 * Handles Next.js dynamic segments (`[x]` -> `{x}`, `[...x]`/`[[...x]]` -> `{x}`)
 * and route groups (`(group)` segments, which don't appear in the URL and are
 * dropped). Best-effort by design — see the file header.
 */
function normalizeRoutePath(filePath: string): string {
  const relative = path.relative(path.join(process.cwd(), "src", "app"), filePath);
  const segments = relative.split(path.sep).slice(0, -1); // drop "route.ts"

  const urlSegments = segments
    .filter((segment) => !/^\(.*\)$/.test(segment)) // route groups: invisible in the URL
    .map((segment) => {
      const catchAll = segment.match(/^\[\.\.\.(.+)\]$/) ?? segment.match(/^\[\[\.\.\.(.+)\]\]$/);
      if (catchAll) return `{${catchAll[1]}}`;
      const dynamic = segment.match(/^\[(.+)\]$/);
      if (dynamic) return `{${dynamic[1]}}`;
      return segment;
    });

  // `relative` already starts with "api" (src/app/api/...), so just prefix "/".
  return `/${urlSegments.join("/")}`;
}

function main() {
  let spec: { paths?: Record<string, unknown> };
  try {
    spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf-8"));
  } catch (err) {
    console.error(`check-openapi: couldn't read/parse ${SPEC_PATH}: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  const specPaths = new Set(Object.keys(spec.paths ?? {}));
  const routeFiles = listRouteFiles(API_ROOT);
  const missing: Array<{ file: string; urlPath: string }> = [];

  for (const file of routeFiles) {
    const urlPath = normalizeRoutePath(file);
    if (!specPaths.has(urlPath)) {
      missing.push({ file: path.relative(process.cwd(), file), urlPath });
    }
  }

  if (missing.length > 0) {
    console.error(`check-openapi: ${missing.length} route(s) missing from public/openapi.json:\n`);
    for (const { file, urlPath } of missing) {
      console.error(`  ${urlPath}  (${file})`);
    }
    console.error(
      "\nAdd a `paths[\"<path>\"]` entry to public/openapi.json for each one above " +
        "(see src/content/docs/api.md#openapi for the workflow), or fix the route's " +
        "path if this normalization guessed wrong."
    );
    process.exit(1);
  }

  console.log(`check-openapi: ${routeFiles.length} route file(s), all present in public/openapi.json.`);
}

main();
