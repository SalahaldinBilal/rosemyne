// Run with: npm run build:extension
// Builds the browser extension into extension/dist/chromium and extension/dist/firefox,
// the folders to load unpacked.
//
// Each entry is its own single-file IIFE build: content scripts can't be ES
// modules, and one multi-entry build would split shared code into a chunk.

import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const ENTRIES = ["background", "content"];
const ICON_SIZES = [32, 64, 128];

const path = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url));

const extensionDir = path("../extension");
const chromiumDir = path("../extension/dist/chromium");
const firefoxDir = path("../extension/dist/firefox");

rmSync(path("../extension/dist"), { recursive: true, force: true });
mkdirSync(path("../extension/dist/chromium/icons"), { recursive: true });

for (const entry of ENTRIES) {
  await build({
    configFile: false,
    root: extensionDir,
    publicDir: false,
    logLevel: "warn",
    build: {
      outDir: chromiumDir,
      emptyOutDir: false,
      target: "es2022",
      minify: false,
      lib: {
        entry: path(`../extension/src/${entry}.ts`),
        formats: ["iife"],
        name: `rosemyne_${entry}`,
        fileName: () => `${entry}.js`,
      },
    },
  });
}

for (const size of ICON_SIZES) {
  copyFileSync(path(`../src-tauri/icons/${size}x${size}.png`), path(`../extension/dist/chromium/icons/${size}.png`));
}

cpSync(chromiumDir, firefoxDir, { recursive: true });

// Chromium rejects `background.scripts` in Manifest V3 and Firefox has no service workers,
// so each browser gets the manifest with only its own background key.
const { browser_specific_settings, background, ...shared } = JSON.parse(readFileSync(path("../extension/manifest.json"), "utf-8"));

function writeManifest(relativePath: string, manifest: object) {
  writeFileSync(path(relativePath), JSON.stringify(manifest, null, 2));
}

writeManifest("../extension/dist/chromium/manifest.json", {
  ...shared,
  background: { service_worker: background.service_worker },
});
writeManifest("../extension/dist/firefox/manifest.json", {
  ...shared,
  background: { scripts: background.scripts },
  browser_specific_settings,
});

console.log(`Built extension ${shared.version} into extension/dist/chromium and extension/dist/firefox`);
