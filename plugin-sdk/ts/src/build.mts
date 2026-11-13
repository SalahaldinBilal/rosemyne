// Bundles a plugin's src/index.ts and compiles it with extism-js into plugin.wasm next to plugin.json.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { build } from "esbuild";
import { ensureTools } from "./tools.mts";

// name, number of arguments. Keep in step with FUNCTIONS in src-tauri/src/plugins/host.rs.
const HOST_FUNCTIONS: Array<[name: string, parameters: number]> = [
  ["log", 1],
  ["kv_get", 1],
  ["kv_set", 2],
  ["kv_delete", 1],
  ["kv_keys", 1],
  ["settings_get", 1],
  ["capture_file", 0],
  ["capture_pixels", 1],
  ["image_set_pixels", 2],
  ["tags_get", 0],
  ["tags_set", 1],
  ["clipboard_write_text", 1],
  ["toast", 1],
  ["http_request", 2],
  ["http_response_body", 0],
  ["asset_put", 2],
];

const ENTRIES = ["src/index.ts", "src/index.js"];

// What extism-js reads to know the plugin's exports and the host functions it imports.
function interfaceFile(hooks: string[]): string {
  const exports = hooks.map(hook => `  export function ${hook}(): I32;`).join("\n");
  const imports = HOST_FUNCTIONS
    .map(([name, count]) => {
      const params = Array.from({ length: count }, (_, index) => `block${index}: I64`).join(", ");
      return `    ${name}(${params}): I64;`;
    })
    .join("\n");
  return `declare module "main" {\n${exports}\n}\n\ndeclare module "extism:host" {\n  interface user {\n${imports}\n  }\n}\n`;
}

// Throws with the reason when the plugin can't be built. Returns the path of plugin.wasm.
export async function buildPlugin(pluginFolder: string): Promise<string> {
  const folder = resolve(pluginFolder);
  if (!existsSync(join(folder, "plugin.json"))) throw new Error(`${folder} has no plugin.json`);
  const entry = ENTRIES.find(path => existsSync(join(folder, path)));
  if (!entry) throw new Error(`${folder} has no src/index.ts`);

  const manifest: { hooks?: unknown } = JSON.parse(readFileSync(join(folder, "plugin.json"), "utf-8"));
  const hooks = Array.isArray(manifest.hooks) ? manifest.hooks.filter((hook): hook is string => typeof hook === "string") : [];
  if (hooks.length === 0) throw new Error("plugin.json lists no hooks");

  const tools = await ensureTools();

  mkdirSync(join(folder, "dist"), { recursive: true });
  await build({
    stdin: {
      contents: `module.exports = require("./${entry}").default;`,
      resolveDir: folder,
      sourcefile: "entry.js",
    },
    outfile: join(folder, "dist/plugin.js"),
    bundle: true,
    format: "cjs",
    target: ["es2020"],
    minify: false,
    logLevel: "warning",
  });
  writeFileSync(join(folder, "dist/plugin.d.ts"), interfaceFile(hooks));

  const output = join(folder, "plugin.wasm");
  const compiled = spawnSync(tools.extismJs, ["dist/plugin.js", "-i", "dist/plugin.d.ts", "-o", "plugin.wasm"], {
    cwd: folder,
    stdio: "inherit",
    env: { ...process.env, PATH: `${tools.binaryenBin}${delimiter}${process.env.PATH ?? ""}` },
  });
  if (compiled.error) throw new Error(`Couldn't run extism-js: ${compiled.error.message}`);
  if (compiled.status !== 0) throw new Error("extism-js couldn't compile the plugin");
  return output;
}
