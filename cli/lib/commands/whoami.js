import { registryUrl, fetchMe } from "../util.js";
import { getToken } from "../auth.js";

export async function run(args) {
  const registry = registryUrl(args.registry);
  const token = getToken(registry);

  if (!token) {
    console.error(`✗ not logged in to ${registry}. Run \`openagents login\`.`);
    process.exitCode = 1;
    return;
  }

  let me;
  try {
    me = await fetchMe(registry, token);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(me, null, 2));
    return;
  }

  const scopes = Array.isArray(me.scopes) && me.scopes.length ? me.scopes.join(", ") : "none";
  console.log(`@${me.handle}${me.name ? ` (${me.name})` : ""}`);
  console.log(`  registry: ${registry}`);
  console.log(`  via:      ${me.via || "unknown"}`);
  console.log(`  scopes:   ${scopes}`);
}
