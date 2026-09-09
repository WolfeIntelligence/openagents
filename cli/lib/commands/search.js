import { registryUrl, fetchJson, renderTable } from "../util.js";

export async function run(args) {
  const query = args._.join(" ").trim();
  if (!query) {
    console.error("✗ usage: openagents search <query> [--registry <url>]");
    process.exitCode = 1;
    return;
  }

  const registry = registryUrl(args.registry);
  let data;
  try {
    data = await fetchJson(`${registry}/api/v1/search?q=${encodeURIComponent(query)}`);
  } catch (err) {
    console.error(`✗ search failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const items = Array.isArray(data) ? data : data.items || [];
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
  console.log(`\n${items.length} package${items.length === 1 ? "" : "s"} found. Install with: openagents add <owner>/<name>`);
}
