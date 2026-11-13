// The two native tools a TypeScript plugin is compiled with. Neither is on npm in a form that
// runs everywhere, so they are downloaded once per user from their GitHub releases and checked
// against the SHA-256 each project published for that release.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const EXTISM_JS_VERSION = "v1.7.0";
const EXTISM_JS_SHA256: Record<string, string> = {
  "aarch64-linux": "025f4050b199d68413c159bde1187271ae270021a9f7171e7beb509922821f2a",
  "aarch64-macos": "12c01c2bb2240a6a05a4f8babe680c793c397d84e6a1497a7ca1312e78a475c3",
  "aarch64-windows": "60ce28cb20d63aa27a4bec555e692891c0353b5db52684383a9891030e19006d",
  "x86_64-linux": "63b72da2f5e88655522dc21477de549f238a2f40546a69ce4e0fce7e78654035",
  "x86_64-macos": "cce4a756eceb34b5aaac5ea864607d6c8b0610535e2c1b0c05a96bdbda69c7bb",
  "x86_64-windows": "409ac023f88f79d763fbf9dd5bb5d9b2fd595ac452e0822d49bf7d05bf6794be",
};

const BINARYEN_VERSION = "version_133";
// Binaryen names 64-bit ARM "arm64" on macOS and Windows, "aarch64" on Linux.
const BINARYEN_SHA256: Record<string, string> = {
  "aarch64-linux": "89c07ea56faf38d0fbecf36ca8ec0721756716185f265b568e133d427f299bf8",
  "arm64-macos": "ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8",
  "arm64-windows": "492a8e1847a0be1554bb9a7f384227981d60bc013aedc02d8ba1372c3943178c",
  "x86_64-linux": "2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489",
  "x86_64-macos": "13a9b90be775c6389ce3d1f879cb8627bea56708ba8c122983941d53a8199b95",
  "x86_64-windows": "17a2cbeac6b5693c5fbafab3838d3c65fd9c1eb38b05f5baec6c657e8c84995b",
};

export type Tools = {
  extismJs: string,
  // Holds wasm-merge and wasm-opt, which extism-js looks for on PATH.
  binaryenBin: string,
}

function operatingSystem(): "windows" | "macos" | "linux" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  if (process.platform === "linux") return "linux";
  throw new Error(`Building TypeScript plugins is not supported on ${process.platform}`);
}

function isArm(): boolean {
  if (process.arch === "arm64") return true;
  if (process.arch === "x64") return false;
  throw new Error(`Building TypeScript plugins is not supported on ${process.arch}`);
}

function cacheDir(): string {
  const base = process.platform === "win32" && process.env.LOCALAPPDATA
    ? process.env.LOCALAPPDATA
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Caches")
      : process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "rosemyne-plugin-pack");
}

async function download(url: string, sha256: string): Promise<Buffer> {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't download ${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw new Error(`${url} doesn't match its expected SHA-256, so it was not used`);
  return bytes;
}

async function extismJs(cache: string): Promise<string> {
  const os = operatingSystem();
  const platform = `${isArm() ? "aarch64" : "x86_64"}-${os}`;
  const path = join(cache, `extism-js-${EXTISM_JS_VERSION}${os === "windows" ? ".exe" : ""}`);
  if (existsSync(path)) return path;

  const url = `https://github.com/extism/js-pdk/releases/download/${EXTISM_JS_VERSION}/extism-js-${platform}-${EXTISM_JS_VERSION}.gz`;
  const packed = await download(url, EXTISM_JS_SHA256[platform]);

  // Written under another name first, so an interrupted run never leaves a half file that looks ready.
  const partial = `${path}.partial`;
  writeFileSync(partial, gunzipSync(packed));
  chmodSync(partial, 0o755);
  renameSync(partial, path);
  return path;
}

async function binaryenBin(cache: string): Promise<string> {
  const os = operatingSystem();
  const arch = isArm() ? (os === "linux" ? "aarch64" : "arm64") : "x86_64";
  const platform = `${arch}-${os}`;
  const folder = join(cache, `binaryen-${BINARYEN_VERSION}`);
  const bin = join(folder, `binaryen-${BINARYEN_VERSION}`, "bin");
  if (existsSync(join(folder, "ready"))) return bin;

  const name = `binaryen-${BINARYEN_VERSION}-${platform}.tar.gz`;
  const url = `https://github.com/WebAssembly/binaryen/releases/download/${BINARYEN_VERSION}/${name}`;
  const archive = join(cache, name);
  writeFileSync(archive, await download(url, BINARYEN_SHA256[platform]));

  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const unpacked = spawnSync("tar", ["-xzf", archive, "-C", folder], { stdio: "inherit" });
  rmSync(archive, { force: true });
  if (unpacked.error) throw new Error(`Couldn't run tar to unpack Binaryen: ${unpacked.error.message}`);
  if (unpacked.status !== 0) throw new Error("Couldn't unpack Binaryen");
  if (!existsSync(bin)) throw new Error("The Binaryen download doesn't hold the folder it should");

  writeFileSync(join(folder, "ready"), "");
  return bin;
}

export async function ensureTools(): Promise<Tools> {
  const cache = cacheDir();
  mkdirSync(cache, { recursive: true });
  return { extismJs: await extismJs(cache), binaryenBin: await binaryenBin(cache) };
}
