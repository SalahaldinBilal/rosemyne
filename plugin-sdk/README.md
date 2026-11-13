# Rosemyne plugins

A plugin is a WebAssembly module that Rosemyne runs in a sandbox. It can:

- run after a capture is saved (screenshot, recording, scrolling capture or import)
- change a screenshot's pixels right before it is saved
- act as an uploader, listed next to the custom uploaders
- write tags under its own top-level tag key
- add entries to a history card's right-click menu
- show settings and modals, described as data and drawn by Rosemyne

A plugin never gets a file path, never runs code in the app's windows, and can only do what its manifest asks for and the user accepted on install.

This document covers plugin API version 1.

## Quick start

### Rust

```toml
# Cargo.toml
[lib]
crate-type = ["cdylib"]

[dependencies]
rosemyne-plugin = { path = "../../rust" }
```

```rust
use rosemyne_plugin::{export_hooks, host, json, CaptureSaved, HookResult};

fn saved(input: CaptureSaved) -> HookResult<()> {
    host::set_tags(Some(&json!({ "Seen": true })))
}

export_hooks! {
    on_capture_saved => saved,
}
```

Put a `plugin.json` next to `Cargo.toml`. The same crate brings the packer, which builds the plugin and writes the `.rosemyne-plugin` file:

```sh
rustup target add wasm32-unknown-unknown
cargo install --path <rosemyne repo>/plugin-sdk/rust
rosemyne-plugin-pack
```

A full example is in `examples/image-stats`.

### TypeScript

Run `npm install` and `npm run build` once in `plugin-sdk/ts` (the build compiles the SDK into `dist`), then `npm install` in your plugin's folder.

```json
{
  "scripts": { "build": "rosemyne-plugin-pack" },
  "dependencies": { "@rosemyne/plugin": "file:../../ts" }
}
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

`npm run build` bundles `src/index.ts`, compiles it to `plugin.wasm` and writes the `.rosemyne-plugin` file. The first run downloads the two compilers it needs (`extism-js` and Binaryen, about 120 MB, checked against their published hashes). Hooks can't be `async`, there is no event loop inside a plugin. A TypeScript plugin carries a JavaScript interpreter, so its `.wasm` is about 1 MB larger than a Rust one.

A full example is in `examples/litterbox-uploader`.

### Trying it

In Rosemyne, open Settings › Plugins.

- **Load unpacked** takes the folder that holds `plugin.json` and `plugin.wasm`. The files stay where they are, and the plugin's page gets a Reload button and shows the log live. Use this while you work on a plugin.
- **Install from file** takes a `.rosemyne-plugin` file, shows the permission prompt and copies the plugin in.

## The package

A `.rosemyne-plugin` file is a zip with these entries. Anything else in it is ignored.

| Entry | Required | Limit |
| --- | --- | --- |
| `plugin.json` | yes | 256 KB |
| `plugin.wasm` | yes | 64 MB |
| `icon.png` | no | 256 KB, shown at 32px |

Each SDK is one package that holds both the library and the packer, and the packer is the same command in both:

```
rosemyne-plugin-pack [folder] [--no-build] [--out <file>]
```

It builds the plugin into `plugin.wasm`, checks `plugin.json` against the rules below and writes `<id>-<version>.rosemyne-plugin`. `--no-build` packs a `plugin.wasm` that is already there.

## plugin.json

```json
{
  "apiVersion": 1,
  "id": "com.example.imgbox",
  "name": "Imgbox",
  "version": "1.2.0",
  "author": "Someone",
  "description": "Uploads captures to imgbox.",
  "homepage": "https://example.com/imgbox",
  "minAppVersion": "0.4.0",
  "tagKey": "Imgbox",
  "permissions": {
    "capturesRead": true,
    "capturesEdit": false,
    "tagsRead": false,
    "tagsWrite": true,
    "clipboardWrite": false,
    "toast": true,
    "network": ["api.imgbox.example", "*.cdn.imgbox.example"]
  },
  "hooks": ["on_capture_saved", "upload", "ui_render", "ui_event", "card_action"],
  "uploaders": [{ "id": "main", "name": "Imgbox" }],
  "cardActions": [{ "id": "albums", "label": "Add to album", "types": ["image", "video"] }],
  "settings": [
    { "type": "group", "title": "Account", "children": [
      { "type": "text", "id": "token", "label": "API token", "secret": true },
      { "type": "toggle", "id": "private", "label": "Private uploads", "value": false }
    ]}
  ]
}
```

Only `apiVersion`, `id`, `name` and `version` are required.

- `id`: 3 to 64 lowercase letters, digits, dots and dashes. It can't start or end with a dot or dash.
- `version`, `minAppVersion`: semver. A plugin that needs a newer app is refused.
- `tagKey`: required with `tagsWrite`. Up to 32 letters, digits and spaces. `Windows` and `Timestamp` are taken, and so is the key of any other installed plugin.
- `network`: bare lowercase hostnames, or `*.example.com` for every subdomain (not the domain itself). No scheme, port, path or IP address.
- `hooks`: the exports Rosemyne may call. An export that isn't listed is never called.
- `uploaders` needs the `upload` hook, `cardActions` needs `card_action`, and `edit_image` needs `capturesEdit`.
- `cardActions[].types`: which cards show the entry, out of `image`, `video` and `file`. Leave it out for all of them.
- `settings`: a tree of static nodes, see [Static settings](#static-settings).

### Permissions

| Permission | Lets the plugin |
| --- | --- |
| `capturesRead` | read the file and pixels of the capture a hook runs for |
| `capturesEdit` | change a screenshot before it is saved |
| `tagsRead` | read the capture's tags, which include window titles and program names |
| `tagsWrite` | write tags under `tagKey` |
| `clipboardWrite` | put text on the clipboard |
| `toast` | show notifications |
| `network` | send HTTPS requests to the listed hosts |

An update that asks for more than the installed version shows the prompt again with the new parts marked.

## Hooks

Every hook gets one JSON input and returns one JSON output. A hook that fails (a Rust `Err`, a thrown JS error, a crash, or running out of time) fails that one call. The error goes to the plugin's log, and for `upload` it becomes the upload error on the card.

| Hook | Input | Output | Time limit |
| --- | --- | --- | --- |
| `on_capture_saved` | `{ capture }` | nothing | 30 s |
| `edit_image` | `{ width, height }` | nothing | 5 s |
| `upload` | `{ uploaderId, capture }` | `{ url, deletionUrl? }` | 60 s |
| `ui_render` | `{ view }` | `{ tree, refreshAfterMs? }` | 2 s |
| `ui_event` | `{ view, id, type, value? }` | `{ tree?, toast?, close?, refreshAfterMs? }` | 2 s |
| `card_action` | `{ actionId, capture }` | `{ modal?, toast? }` | 2 s |

Time spent waiting on an HTTP request doesn't count toward the limit.

`capture` is `{ fileName, type, dateTimeMs, width?, height?, fileSize?, url?, tags? }`. `type` is `image`, `video` or `file`. `width` and `height` are there for images, `url` once the capture has been uploaded, and `tags` only with `tagsRead`.

- **`on_capture_saved`** runs on its own after every save and never delays the capture.
- **`edit_image`** runs right before a screenshot is encoded. Read the image with `capture_pixels`, replace it with `image_set_pixels`. Plugins run in the order of the Plugins list, each getting the previous one's result. It delays every screenshot, so keep it fast. A plugin that runs out of time 3 times in a row is paused. Recordings and imports are not edited.
- **`upload`** runs when the user uploads with one of the plugin's uploaders. Send the file with a `captureFile` body or part, which also drives the progress bar on the card.
- **`ui_render`**, **`ui_event`**, **`card_action`**: see [Views](#views).

Calls to one plugin run one at a time. Memory may or may not survive between calls, so keep anything you need in the key-value store.

## Host functions

The names below are the Rust ones in `rosemyne_plugin::host`. TypeScript has the same set on `host` in camelCase (`host.kvGet`, `host.setTags`, `host.http`, and so on).

A call the plugin has no permission for, or one made outside the hook it belongs to, ends the hook with an error.

| Function | Needs | Does |
| --- | --- | --- |
| `log(level, text)` | | Adds a line to the plugin's log (last 500 lines are kept). |
| `kv_get(key)` | | Reads from the plugin's own storage. |
| `kv_set(key, bytes)` | | Writes. 1 GB per plugin, 256 MB per value, 256 byte keys. |
| `kv_delete(key)` | | |
| `kv_keys(prefix)` | | Lists keys. |
| `setting(id)` | | The value of a static setting, or its default from the manifest. |
| `capture_file()` | `capturesRead` | The capture's saved file. Refused over 256 MB. |
| `capture_pixels(max_side)` | `capturesRead` | RGBA pixels, optionally scaled down. Images only. Inside `edit_image` it is the image being edited and needs only `capturesEdit`. |
| `set_image_pixels(width, height, rgba)` | `capturesEdit` | Replaces the image. Only inside `edit_image`. |
| `tags()` | `tagsRead` | All tags of the capture. |
| `set_tags(value)` | `tagsWrite` | Replaces everything under `tagKey` on the capture. `None`/`null` removes it. 64 KB at most. |
| `clipboard_write_text(text)` | `clipboardWrite` | |
| `toast(kind, text)` | `toast` | Shows "<plugin name>: <text>" in the main window. One per 2 seconds, the rest are dropped. |
| `asset_put(id, mime, bytes)` | | Stores an image for an `image` node. PNG, JPEG, WebP or GIF, 8 MB per plugin, kept in memory until the app closes. |
| `HttpRequest::send()` / `host.http()` | `network` | See [Network](#network). |

"The capture" is always the one the running hook was called for. `ui_render` and `ui_event` run for no capture, so the capture functions fail there. There is no way to list or read other captures.

Storage is plain on disk. A token saved there is as readable as the rest of the user's settings.

### Network

```rust
let response = HttpRequest::post("https://api.imgbox.example/upload")
    .header("Authorization", format!("Bearer {token}"))
    .multipart(vec![
        Part::capture_file("file"),
        Part::text("private", "1"),
    ])
    .send()?;
```

```ts
const response = host.http({
  method: "POST",
  url: "https://api.imgbox.example/upload",
  headers: [["Authorization", `Bearer ${token}`]],
  body: { type: "multipart", parts: [
    { name: "file", captureFile: true },
    { name: "private", text: "1" },
  ]},
});
```

Body types: `none`, `text`, `json`, `bytes`, `captureFile`, `multipart`. A `captureFile` body or part is sent by Rosemyne straight from the saved file, so a large video never has to fit in the plugin's memory. It needs `capturesRead`. A request can carry one block of the plugin's own bytes, as the `bytes` body or as one multipart part.

Rules:

- `https` only, and the host must match an entry of `network`.
- Hosts that resolve to a loopback, private or link-local address are refused.
- Up to 5 redirects, each checked the same way.
- No cookies are kept between requests and the system proxy is not used.
- The timeout is 30 s unless the request sets one (1 s to 10 min).
- Responses over 32 MB fail.

A network failure or a refused host comes back as an error you can handle (`Err` in Rust, a thrown `Error` in TypeScript). An HTTP error status is a normal response.

## Views

A view is a list of nodes. Rosemyne draws them with its own components, so a plugin's settings look like the rest of the app.

```json
[{ "type": "group", "title": "Account", "children": [
  { "type": "label", "text": "Signed in as someone" },
  { "type": "button", "id": "sign-out", "label": "Sign out", "variant": "danger" }
]}]
```

| Type | Props |
| --- | --- |
| `group` | `title`, `description`, `children` |
| `inline` | `label`, `hint`, `children` (controls side by side in one row) |
| `toggle` | `label`, `hint`, `value` |
| `select` | `label`, `hint`, `items: [{ value, label }]`, `value` |
| `segmented` | `label`, `hint`, `items`, `value` |
| `number` | `label`, `hint`, `min`, `max`, `step`, `unit`, `value` |
| `duration` | `label`, `hint`, `value` (ms) |
| `fileSize` | `label`, `hint`, `value` (bytes) |
| `dimension` | `label`, `hint`, `min`, `max`, `value: { width, height }` |
| `text` | `label`, `hint`, `placeholder`, `maxLength`, `secret`, `value` |
| `template` | `label`, `hint`, `placeholder`, `variables: [{ name, description }]`, `value` |
| `button` | `label`, `variant` (`primary`, `secondary`, `ghost`, `danger`, `danger-solid`, `warn`), `disabled` |
| `label` | `text`, `tone` (`normal`, `muted`, `warn`, `danger`) |
| `badge` | `text`, `tone` (`neutral`, `accent`, `ok`, `warn`, `danger`) |
| `progress` | `value` (0 to 1) or `indeterminate` |
| `emptyState` | `title`, `text` |
| `link` | `label`, `url` (https only, the app asks before opening it) |
| `image` | `asset` (an id from `asset_put`), `maxHeight` |

Unknown node types are skipped and unknown props ignored.

Limits per tree: 300 nodes, 6 levels deep, 2,000 characters per text, 200 items per `select`, ids unique and at most 64 characters. A tree over a limit is dropped and the reason goes to the log.

### Static settings

The `settings` list in `plugin.json` may hold `group`, `inline` and the input nodes (`toggle` through `template`). Every input needs an `id`. Rosemyne shows them on the plugin's page, stores what the user picks, and never calls the plugin for them. Read a value with `setting(id)`. Its `value` in the manifest is the default.

They also show up in the settings search.

### The plugin's own view

With the `ui_render` hook, the plugin's page also shows the tree returned for the view `settings`.

- An input the user changes sends `ui_event` with `{ view, id, type: "change", value }`. Text is sent when the field is left or Enter is pressed, not per key.
- A button sends `{ view, id, type: "click" }`.
- The reply can hold a new `tree`, a `toast`, and `refreshAfterMs`. With `refreshAfterMs` (500 ms at least) Rosemyne calls `ui_render` again after that long while the view is still open. That is the only way a view changes without the user doing something.

Nodes are matched by `id` between trees, so give a node an `id` when it should keep its place.

### Card actions and modals

Each entry of `cardActions` is shown at the bottom of a card's right-click menu. Clicking it calls `card_action` with the action's id and the capture. The reply can show a toast, open a modal, or both:

```json
{ "modal": {
  "title": "Add to album",
  "tree": [],
  "actions": [{ "id": "add", "label": "Add", "variant": "primary" }]
}}
```

Rosemyne draws the frame and the footer, with Cancel on the left and the plugin's `actions` on the right. Controls in the tree and the footer buttons send `ui_event` with the view `modal:<actionId>`. Reply with `close: true` to close the modal.

Modal events carry no capture. If a button needs to know which capture the modal was opened for, save that in the key-value store during `card_action`.

## Limits

| | |
| --- | --- |
| Memory | 1 GB per plugin |
| Waiting calls | 32 per plugin, further `on_capture_saved` calls are dropped |
| Storage | 1 GB per plugin |
| Log | last 500 lines, 2,000 characters per line |
| Toasts | 1 per 2 s |
| Images for views | 8 MB per plugin |
