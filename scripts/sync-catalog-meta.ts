// Regenerates catalog/<owner>/<name>/.meta.json from real data.
//
// `.meta.json` holds the two things about a seed package that cannot be derived
// from its own files: the editorial `featured` flag, and the package's real
// created/updated timestamps taken from git history.
//
// Dates come from git rather than filesystem mtimes because deployed bundles
// (Vercel) normalize mtimes to a bogus epoch, and because a checkout's mtimes
// reflect when the clone happened, not when the package changed. They are
// committed to the repo so the site never has to run git at build time (Vercel
// clones shallow, so `git log` there sees only the tip commit).
//
// Run with: npm run sync:meta   (== npx tsx scripts/sync-catalog-meta.ts)
// Re-run after adding or changing a package, and commit the result.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CATALOG_ROOT = path.join(process.cwd(), "catalog");
const META_FILE = ".meta.json";
const LEGACY_META_FILE = ".stats.json";

interface Meta {
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

/** ISO date of the commit that added `dir`, and of the last commit to touch it. */
function gitDates(dir: string): { createdAt: string; updatedAt: string } | null {
  const created = git(["log", "--diff-filter=A", "--format=%cI", "--reverse", "--", dir])
    .split("\n")
    .filter(Boolean)[0];
  // Exclude .meta.json itself: regenerating these files must not make every
  // package look "updated today".
  const updated = git(["log", "-1", "--format=%cI", "--", dir, `:(exclude)${dir}/.meta.json`]);
  if (!created || !updated) return null;
  return {
    createdAt: new Date(created).toISOString(),
    updatedAt: new Date(updated).toISOString(),
  };
}

function readJsonSafe<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function main() {
  if (!fs.existsSync(CATALOG_ROOT)) {
    console.error("no catalog/ directory found");
    process.exitCode = 1;
    return;
  }

  let written = 0;
  let skipped = 0;

  for (const owner of listDirs(CATALOG_ROOT)) {
    for (const name of listDirs(path.join(CATALOG_ROOT, owner))) {
      const pkgDir = path.join(CATALOG_ROOT, owner, name);
      const relDir = `catalog/${owner}/${name}`;
      const metaPath = path.join(pkgDir, META_FILE);
      const legacyPath = path.join(pkgDir, LEGACY_META_FILE);

      // Preserve the editorial flag from whichever file already exists.
      const existing =
        readJsonSafe<Partial<Meta>>(metaPath) ?? readJsonSafe<Partial<Meta>>(legacyPath) ?? {};

      const dates = gitDates(relDir);
      if (!dates) {
        // Not committed yet — leave any existing file alone rather than invent a date.
        console.warn(`  skip ${owner}/${name}: no git history yet (commit it, then re-run)`);
        skipped++;
        continue;
      }

      const meta: Meta = {
        featured: existing.featured === true,
        createdAt: dates.createdAt,
        updatedAt: dates.updatedAt,
      };

      fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
      if (fs.existsSync(legacyPath)) fs.rmSync(legacyPath);

      console.log(
        `  ok   ${owner}/${name} created=${meta.createdAt.slice(0, 10)} updated=${meta.updatedAt.slice(0, 10)}${meta.featured ? " featured" : ""}`
      );
      written++;
    }
  }

  console.log(`\n${written} package(s) written, ${skipped} skipped.`);
}

main();
