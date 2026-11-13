# Rosemyne

A ShareX-like screenshot capture, annotate, and upload tool built with [Tauri 2](https://tauri.app/) and [SolidJS](https://www.solidjs.com/).

## Features

**Capture**

- Screenshots of the whole desktop, a dragged region, or a window you right-click to snap to
- Screen recording to MP4 with system audio
- Scrolling capture, which scrolls a window and stitches the frames into one tall image you can review, restitch and crop
- Instant capture of a fixed monitor or area, with no selection step

**Edit**

- Box, text, blur, pixelate and freehand drawing on the selection before it is saved
- The same tools on any image already in the history, saved as a new capture
- Your own defaults for colors, thickness, fonts and effect strength

**Keep and find**

- A history of every capture, with search, type and date filters
- Tags on each capture for the windows that were in it, plus your own, with an editor for them
- An advanced filter builder over those tags, with filters you can save by name
- Drag a capture out of the history straight into another app

**Share**

- Upload to any host with the custom uploader builder (headers, params, body, response parsing, variables), with a live test
- Auto-upload on capture, and the link copied to the clipboard
- A small preview popup after each capture, with click actions you choose

**Fit your setup**

- Any number of global shortcuts per action, each able to override the normal settings (upload target, file name, format, recording quality and more)
- File name and folder templates
- "Upload with Rosemyne" in the file manager's right-click menu on Windows
- A [browser extension](#browser-extension) that copies or uploads media from a page
- [Plugins](#plugins)
- ShareX history import
- Tray icon, start with the system, built-in updates, and a first-launch setup wizard

## Platform support

| Platform | Status |
| --- | --- |
| Windows | Primary target, fully supported |
| Linux (X11 and Wayland) | Partial. The app builds and runs, but screen capture and recording aren't implemented yet |
| macOS | Not supported |

## Plugins

Rosemyne can be extended with plugins. A plugin is a WebAssembly module that runs in a sandbox inside the app, and it can:

- run after a capture is saved
- change a screenshot right before it is saved
- add an uploader next to the custom ones
- write its own tags on a capture
- add entries to a capture's right-click menu
- show its own settings and dialogs, drawn by Rosemyne

A plugin only gets what its manifest asks for and you accept when you install it: reading captures, editing them, tags, the clipboard, notifications, and a fixed list of hosts it may connect to. It never gets a file path and can't reach the rest of your history.

**Using plugins**: open Settings › Plugins and choose "Install from file", or drop a `.rosemyne-plugin` file on that page. Rosemyne shows what the plugin will be able to do before anything is installed. Plugins come from files only. There is no store.

**Writing plugins**: there is an SDK for Rust and one for TypeScript. Each one is the library you write the plugin with and the `rosemyne-plugin-pack` command that builds it into a `.rosemyne-plugin` file.

| Language | Package | Folder |
| --- | --- | --- |
| Rust | [`rosemyne-plugin`](https://crates.io/crates/rosemyne-plugin) on crates.io | [`plugin-sdk/rust`](plugin-sdk/rust) |
| TypeScript | [`@rosemyne/plugin`](https://www.npmjs.com/package/@rosemyne/plugin) on npm | [`plugin-sdk/ts`](plugin-sdk/ts) |

The [plugin guide](plugin-sdk/README.md) covers the manifest, the hooks, what a plugin can ask the app to do, the view nodes and the limits. Two working examples are in [`plugin-sdk/examples`](plugin-sdk/examples): a Rust plugin that tags screenshots, and a TypeScript plugin that adds an uploader.

## Browser extension

The extension (Chromium browsers and Firefox) adds a "Rosemyne" entry to the page right-click menu, to copy an image or video or send it to Rosemyne. It talks to the app on your own machine only, and only while "Browser extension support" is turned on under Settings › General.

Build it with `npm run build:extension`, then load `extension/dist/chromium` or `extension/dist/firefox` as an unpacked extension.

## Development

```sh
npm install
npm run tauri dev
```

This starts the Vite dev server and the Tauri/Rust backend together. `npm run dev` runs the frontend alone (Tauri APIs won't be available).

Checks:

```sh
npx tsc --noEmit        # type-check the frontend
cd src-tauri
cargo check             # compile the backend
cargo test              # backend unit tests
```

Where things are:

| Folder | What |
| --- | --- |
| `src/` | The frontend (SolidJS + TypeScript) |
| `src-tauri/` | The backend (Rust) |
| `extension/` | The browser extension |
| `plugin-sdk/` | The plugin SDKs, examples and plugin guide |
| `scripts/` | Build and release scripts |

## Building

```sh
npm run tauri build   # production bundle
npm run build:debug   # debug bundle
```

## Data

Settings, history and saved captures live in `Documents/Rosemyne/` by default. The save directory can be changed in Settings. Installed plugins and their data stay in `Documents/Rosemyne/` either way.

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## License

GPL-3.0-or-later.

## Attribution

Notification sounds (`src-tauri/assets/sounds/`) are from [Freesound](https://freesound.org/), licensed [CC0](http://creativecommons.org/publicdomain/zero/1.0/):

- Capture shutter, [Contarex camera shutter.wav](https://freesound.org/people/Tonik1105/sounds/520684/) by [Tonik1105](https://freesound.org/people/Tonik1105/)
- Task success, [Notification Sound 2](https://freesound.org/people/deadrobotmusic/sounds/750608/) by [deadrobotmusic](https://freesound.org/people/deadrobotmusic/)
