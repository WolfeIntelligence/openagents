import { registryUrl } from "../util.js";

export function run(args) {
  const registry = registryUrl(args.registry);
  console.log("Publishing from the CLI is coming soon.");
  console.log("");
  console.log(`For now: sign in at ${registry}/publish, or POST your manifest + files to`);
  console.log(`${registry}/api/v1/publish`);
  console.log("");
  console.log("Free packages: open a PR adding your package under catalog/<owner>/<name>/");
  console.log("in https://github.com/openagents/openagents — see CONTRIBUTING.md.");
}
