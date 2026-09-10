import { registryUrl, fetchJson, renderTable, existsSync } from "../util.js";
import { detectRuntime } from "../runtimes.js";

export async function run(args) {
  const query = args._.join(" ").trim();
  if (!query) {
    console.error("✗ usage: openagents search <query> [--registry <url>] [--json]");
    process.exitCode = 1;
    return;
  }

  const registry = registryUrl(args.registry);
  const runtime = detectRuntime(process.cwd(), existsSync);
  let data;
  try {
    data = await fetchJson(`${registry}/api/v1/search?q=${encodeURIComponent(query)}`, { runtime });
  } catch (err) {
    console.error(`✗ search failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // The API is transitioning from a bare array, to {items}, to {items, total}.
  const items = Array.isArray(data) ? data : data.items || [];
  const total = Array.isArray(data) ? undefined : data.total;

  if (items.length === 0) {
    console.log(`No packages found for "${query}".`);
    return;
  }

  console.log(
    renderTable(items, [
      { label: "PACKAGE", get: (r) => r.id || `${r.owner}/${r.name}` },
      { label: "KIND", get: (r) => r.kind },
      { label: "VERSION", get: (r) => r.version },
      { label: "PRICE", get: (r) => (r.pricing?.model === "free" ? "free" : `$${(r.pricing?.amountCents ?? 0) / 100}`) },
      { label: "STARS", get: (r) => r.stats?.stars ?? "" },
      { label: "SUMMARY", get: (r) => r.summary },
    ])
  );

  if (typeof total === "number" && total !== items.length) {
    console.log(`\nshowing ${items.length} of ${total}. Install with: openagents add <owner>/<name>`);
  } else {
    console.log(`\n${items.length} package${items.length === 1 ? "" : "s"} found. Install with: openagents add <owner>/<name>`);
  }
}
