import { registryUrl } from "../util.js";
import { clearToken } from "../auth.js";

export function run(args) {
  const registry = registryUrl(args.registry);
  const removed = clearToken(registry);
  if (removed) {
    console.log(`✓ logged out of ${registry}`);
  } else {
    console.log(`not logged in to ${registry}`);
  }
}
