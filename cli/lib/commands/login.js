// `openagents login [--token <oa_...>] [--registry <url>]`
//
// `POST /api/v1/tokens` (minting a token) is session-only — it requires
// signing in on the site — so the CLI cannot mint a token itself. Instead:
// create one at `<registry>/settings/tokens` and either pass it with
// `--token`, pipe it on stdin (`echo $TOKEN | openagents login`), or paste
// it at an interactive prompt (echo off).

import readline from "node:readline";
import { Writable } from "node:stream";
import { registryUrl, fetchMe } from "../util.js";
import { setToken } from "../auth.js";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/** Prompt on the TTY for a line of input without echoing it back. */
function promptHidden(promptText) {
  return new Promise((resolve, reject) => {
    const muted = new Writable({
      write(chunk, encoding, callback) {
        if (!muted.isMuted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    muted.isMuted = false;

    const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    process.stdout.write(promptText);
    muted.isMuted = true;
    rl.question("", (answer) => {
      muted.isMuted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
    rl.on("error", reject);
  });
}

export async function run(args) {
  const registry = registryUrl(args.registry);

  let token = typeof args.token === "string" ? args.token.trim() : undefined;

  if (!token) {
    if (process.stdin.isTTY) {
      console.log(`Create a token at ${registry}/settings/tokens, then paste it below.`);
      token = (await promptHidden("Token: ")).trim();
    } else {
      token = (await readStdin()).trim();
    }
  }

  if (!token) {
    console.error("✗ no token provided (pass --token, pipe one on stdin, or run interactively)");
    process.exitCode = 1;
    return;
  }

  let me;
  try {
    me = await fetchMe(registry, token);
  } catch (err) {
    console.error(`✗ could not verify token: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  setToken(registry, token, { handle: me.handle });

  const scopes = Array.isArray(me.scopes) && me.scopes.length ? me.scopes.join(", ") : "none";
  console.log(`✓ logged in as @${me.handle} (scopes: ${scopes})`);
}
