// `openagents publish [dir] [--changelog <text>] [--dry-run] [--json] [--registry <url>]`
// `openagents publish --from-github <url> [--ref <ref>] [--subdir <path>] [--changelog <text>] [--dry-run] [--json] [--registry <url>]`

import path from "node:path";
import { registryUrl, formatPrice, responseError, userAgentHeaders, authHeaders } from "../util.js";
import { getToken } from "../auth.js";
import { packDirectory, PackError } from "../pack.js";

export async function run(args) {
  const registry = registryUrl(args.registry);

  if (typeof args["from-github"] === "string") {
    return publishFromGithub(args, registry);
  }

  const dir = path.resolve(args._[0] || ".");

  let packed;
  try {
    packed = packDirectory(dir);
  } catch (err) {
    if (err instanceof PackError) {
      console.error(`✗ ${err.message}:`);
      for (const issue of err.issues) console.error(`  - ${issue}`);
    } else {
      console.error(`✗ ${err.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const { manifest, files } = packed;
  const changelog = typeof args.changelog === "string" ? args.changelog : packed.changelog;

  printSummary(manifest, files);

  if (args["dry-run"]) {
    console.log("\n(dry run — not published)");
    return;
  }

  const token = getToken(registry);
  if (!token) {
    console.error(`\n✗ not logged in to ${registry}. Run \`openagents login\` first.`);
    process.exitCode = 1;
    return;
  }

  const body = { files };
  if (changelog) body.changelog = changelog;

  await postAndReport(`${registry}/api/v1/publish`, body, registry, args);
}

async function publishFromGithub(args, registry) {
  const repo = args["from-github"];

  const token = getToken(registry);
  if (!token) {
    console.error(`✗ not logged in to ${registry}. Run \`openagents login\` first.`);
    process.exitCode = 1;
    return;
  }

  const body = { repo };
  if (typeof args.ref === "string") body.ref = args.ref;
  if (typeof args.subdir === "string") body.subdir = args.subdir;
  if (typeof args.changelog === "string") body.changelog = args.changelog;

  console.log(`repo:   ${repo}`);
  if (body.ref) console.log(`ref:    ${body.ref}`);
  if (body.subdir) console.log(`subdir: ${body.subdir}`);

  if (args["dry-run"]) {
    console.log("\n(dry run — not published)");
    return;
  }

  await postAndReport(`${registry}/api/v1/publish/import`, body, registry, args);
}

function printSummary(manifest, files) {
  const totalBytes = files.reduce((n, f) => n + Buffer.byteLength(f.content, "utf8"), 0);
  const price =
    !manifest.pricing || manifest.pricing.model === "free"
      ? "free"
      : formatPrice(manifest.pricing.amount_cents, manifest.pricing.currency);

  console.log(`${manifest.owner}/${manifest.name}@${manifest.version}`);
  console.log(`  kind:  ${manifest.kind}`);
  console.log(`  files: ${files.length} (${(totalBytes / 1024).toFixed(1)}KB total)`);
  console.log(`  price: ${price}`);
}

async function postAndReport(url, body, registry, args) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...userAgentHeaders(),
        ...authHeaders(registry),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`✗ could not reach ${url}: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    const err = await responseError(url, res, "POST");
    if (res.status === 409) {
      console.error(`✗ ${err.message}`);
      console.error(`  bump the version in openagent.yaml and try again.`);
    } else if (err.body && Array.isArray(err.body.issues) && err.body.issues.length) {
      console.error(`✗ ${err.body.error || "publish failed"}:`);
      for (const issue of err.body.issues) console.error(`  - ${issue}`);
    } else {
      console.error(`✗ ${err.message}`);
    }
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = await res.json();
  } catch (err) {
    console.error(`✗ ${url} did not return valid JSON: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n✓ published ${result.id}@${result.version}`);
  console.log(`  ${result.url}`);
  if (result.status && result.status !== "published") {
    console.log(`  status: ${result.status}${result.status === "pending" ? " (awaiting review)" : ""}`);
  }
}
