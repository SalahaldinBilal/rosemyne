#!/usr/bin/env node
import { buildPlugin } from "./build.mts";
import { packPlugin } from "./pack.mts";

const USAGE = `Usage: rosemyne-plugin-pack [folder] [--no-build] [--out <file>]

Builds the plugin in <folder> (default: the current one) into plugin.wasm, checks plugin.json
and writes <id>-<version>.rosemyne-plugin.

  --no-build   Pack the plugin.wasm that is already there
  --out <file> Where to write the package`;

function fail(message: string): never {
  console.error(`rosemyne-plugin-pack: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

let folder = ".";
let output: string | undefined;
let build = true;

for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--no-build") {
    build = false;
  } else if (arg === "--out") {
    output = args[++index];
    if (output === undefined) fail("--out needs a file");
  } else if (arg.startsWith("-")) {
    fail(`Unknown option ${arg}\n\n${USAGE}`);
  } else {
    folder = arg;
  }
}

try {
  if (build) await buildPlugin(folder);
  console.log(`Packed into ${packPlugin(folder, output)}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
