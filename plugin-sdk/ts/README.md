# @rosemyne/plugin

Write, build and pack [Rosemyne](https://github.com/SalahaldinBilal/rosemyne) plugins in TypeScript.

```sh
npm install @rosemyne/plugin
```

```ts
// src/index.ts
import { definePlugin, host } from "@rosemyne/plugin";

export default definePlugin({
  on_capture_saved({ capture }) {
    host.setTags({ Seen: true });
  },
});
```

Put a `plugin.json` next to `package.json`, then run `npx rosemyne-plugin-pack`. It writes the `.rosemyne-plugin` file you install in Rosemyne under Settings › Plugins.

Hooks can't be `async`. There is no event loop inside a plugin.

The manifest, hooks, host functions and view nodes are described in the [plugin guide](https://github.com/SalahaldinBilal/rosemyne/blob/main/plugin-sdk/README.md).

## The packer

```
rosemyne-plugin-pack [folder] [--no-build] [--out <file>]
```

Run in the folder that holds `plugin.json` and `src/index.ts`, it:

1. bundles `src/index.ts` and compiles it to `plugin.wasm`
2. checks `plugin.json` against the rules Rosemyne applies on install
3. writes `<id>-<version>.rosemyne-plugin` from `plugin.json`, `plugin.wasm` and `icon.png` if there is one

`--no-build` packs a `plugin.wasm` that is already there.

The same two steps from code:

```ts
import { buildPlugin, packPlugin } from "@rosemyne/plugin/pack";

await buildPlugin("my-plugin");
const file = packPlugin("my-plugin");
```

### What it downloads

Compiling needs two native tools that npm can't deliver: [`extism-js`](https://github.com/extism/js-pdk) and [Binaryen](https://github.com/WebAssembly/binaryen). The first build downloads both from their GitHub releases (about 120 MB, mostly Binaryen), checks each against the SHA-256 published with that release, and keeps them per user:

- Windows: `%LOCALAPPDATA%\rosemyne-plugin-pack`
- macOS: `~/Library/Caches/rosemyne-plugin-pack`
- Linux: `$XDG_CACHE_HOME/rosemyne-plugin-pack` or `~/.cache/rosemyne-plugin-pack`

Unpacking Binaryen uses the system's `tar`.
