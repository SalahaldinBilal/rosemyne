# Rosemyne

A ShareX-like screenshot capture, annotate, and upload tool built with [Tauri 2](https://tauri.app/) and [SolidJS](https://www.solidjs.com/).

## Features

- Full virtual-desktop capture with drag-to-select region, or right-click to snap to a detected window
- Screen recording to MP4, with system audio
- Box, text, blur, and pixelate overlays on the selection before saving
- Save to disk, copy to clipboard, and a searchable/filterable history gallery with per-window capture tags
- Configurable upload targets: custom request builder (headers, params, body, response parsing) with variable substitution, saved uploaders, and auto-upload on capture
- ShareX history import
- Global shortcuts, tray icon, and a first-launch setup wizard

## Platform support

| Platform | Status |
| --- | --- |
| Windows | Primary target, fully supported |
| Linux (X11 and Wayland) | Partial , the app builds and runs, but screen capture and recording aren't implemented yet |
| macOS | Not supported |

## Development

```sh
npm install
npm run tauri dev
```

This starts the Vite dev server and the Tauri/Rust backend together. `npm run dev` runs the frontend alone (Tauri APIs won't be available).

## Building

```sh
npm run tauri build   # production bundle
npm run build:debug   # debug bundle
```

The Rust backend alone can be checked with `cargo check` / `cargo build` inside `src-tauri/`.

## Data

User data (settings, history, saved images) lives in `Documents/Rosemyne/` by default; the save directory can be changed in Settings.

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Attribution

Notification sounds (`src-tauri/assets/sounds/`) are from [Freesound](https://freesound.org/), licensed [CC0](http://creativecommons.org/publicdomain/zero/1.0/):

- Capture shutter , [Contarex camera shutter.wav](https://freesound.org/people/Tonik1105/sounds/520684/) by [Tonik1105](https://freesound.org/people/Tonik1105/)
- Task success , [Notification Sound 2](https://freesound.org/people/deadrobotmusic/sounds/750608/) by [deadrobotmusic](https://freesound.org/people/deadrobotmusic/)
