// Checks <folder>/plugin.json against the rules Rosemyne applies on install and writes
// <id>-<version>.rosemyne-plugin from plugin.json, plugin.wasm and icon.png (if there is one).
//
// The rules mirror manifest.rs and tree.rs in plugin-sdk/rust/src. Keep them in step.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const API_VERSION = 1;
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const HOOKS = ["on_capture_saved", "edit_image", "upload", "ui_render", "ui_event", "card_action"];
const RESERVED_TAG_KEYS = ["windows", "timestamp"];
const CONTAINERS = ["group", "inline"];
const INPUTS = ["toggle", "select", "segmented", "number", "duration", "fileSize", "dimension", "text", "template"];
const CARD_TYPES = ["image", "video", "file"];
const MAX_NODES = 300;
const MAX_DEPTH = 6;
const MAX_STRING = 2000;
const MAX_ITEMS = 200;
const MAX_ID = 64;
const LIMITS = { "plugin.json": 256 * 1024, "plugin.wasm": 64 * 1024 * 1024, "icon.png": 256 * 1024 };

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const PLUGIN_ID = /^[a-z0-9.-]{3,64}$/;
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TAG_KEY = /^[\p{L}\p{N} ]{1,32}$/u;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

type Json = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(message);
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown, what: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${what} must be a list`);
  return value;
}

function label(value: unknown, what: string): void {
  const length = typeof value === "string" ? [...value.trim()].length : 0;
  if (length < 1 || length > 64) fail(`${what} must be 1 to 64 characters`);
}

function checkStrings(value: unknown): void {
  if (typeof value === "string" && [...value].length > MAX_STRING) fail(`A text is longer than ${MAX_STRING} characters`);
  if (Array.isArray(value)) value.forEach(checkStrings);
  else if (isObject(value)) Object.values(value).forEach(checkStrings);
}

function checkSettings(nodes: unknown[]): void {
  const ids = new Set<string>();
  let count = 0;

  function visit(node: unknown, depth: number): void {
    if (!isObject(node)) fail("settings: every node must be an object");
    count += 1;
    if (count > MAX_NODES) fail(`settings: more than ${MAX_NODES} nodes`);
    if (depth > MAX_DEPTH) fail(`settings: nested deeper than ${MAX_DEPTH} levels`);

    const type = node.type;
    if (typeof type !== "string") fail("settings: a node has no type");
    if (!CONTAINERS.includes(type) && !INPUTS.includes(type)) fail(`settings: "${type}" nodes are not allowed in manifest settings`);

    if (node.id === undefined) {
      if (INPUTS.includes(type)) fail(`settings: a "${type}" setting has no id`);
    } else {
      if (typeof node.id !== "string" || node.id.length < 1 || node.id.length > MAX_ID) fail(`settings: a node id must be 1 to ${MAX_ID} characters`);
      if (ids.has(node.id)) fail(`settings: node id "${node.id}" is used twice`);
      ids.add(node.id);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "children") {
        list(value, "settings: children").forEach(child => visit(child, depth + 1));
      } else if (key === "items" || key === "variables") {
        if (list(value, `settings: ${key}`).length > MAX_ITEMS) fail(`settings: more than ${MAX_ITEMS} ${key}`);
        checkStrings(value);
      } else {
        checkStrings(value);
      }
    }
  }

  nodes.forEach(node => visit(node, 1));
}

function checkNetworkEntry(entry: unknown): void {
  const host = typeof entry === "string" ? entry.replace(/^\*\./, "") : "";
  const valid = host.length > 0 && host.length <= 253 && host.includes(".")
    && host.split(".").every(part => HOST_LABEL.test(part)) && !IPV4.test(host);
  if (!valid) fail(`Network entry "${String(entry)}" is not valid. Use a lowercase hostname like api.example.com or *.example.com`);
}

function checkManifest(manifest: unknown): { id: string, version: string } {
  if (!isObject(manifest)) fail("plugin.json must hold an object");

  if (manifest.apiVersion !== API_VERSION) fail(`apiVersion must be ${API_VERSION}`);

  const id = manifest.id;
  const idValid = typeof id === "string" && PLUGIN_ID.test(id) && !/^[.-]|[.-]$/.test(id) && !id.includes("..");
  if (!idValid) fail(`Plugin id "${String(id)}" is not valid. Use 3 to 64 lowercase letters, digits, dots and dashes`);

  label(manifest.name, "The plugin name");

  const version = manifest.version;
  if (typeof version !== "string" || !SEMVER.test(version)) fail(`Plugin version "${String(version)}" is not a valid version`);
  if (manifest.minAppVersion !== undefined && manifest.minAppVersion !== null
    && (typeof manifest.minAppVersion !== "string" || !SEMVER.test(manifest.minAppVersion))) {
    fail(`minAppVersion "${String(manifest.minAppVersion)}" is not a valid version`);
  }

  const permissions = manifest.permissions === undefined ? {} : manifest.permissions;
  if (!isObject(permissions)) fail("permissions must be an object");

  const tagKey = manifest.tagKey;
  if (tagKey === undefined || tagKey === null) {
    if (permissions.tagsWrite === true) fail("A plugin that writes tags must set tagKey");
  } else {
    if (typeof tagKey !== "string" || !TAG_KEY.test(tagKey) || tagKey !== tagKey.trim()) {
      fail(`tagKey "${String(tagKey)}" is not valid. Use up to 32 letters, digits and spaces`);
    }
    if (RESERVED_TAG_KEYS.includes(tagKey.toLowerCase())) fail(`tagKey "${tagKey}" is reserved`);
  }

  list(permissions.network, "permissions.network").forEach(checkNetworkEntry);

  const hooks = list(manifest.hooks, "hooks");
  for (const hook of hooks) {
    if (typeof hook !== "string" || !HOOKS.includes(hook)) fail(`Unknown hook "${String(hook)}"`);
  }

  const uploaders = list(manifest.uploaders, "uploaders");
  const cardActions = list(manifest.cardActions, "cardActions");
  if (uploaders.length > 0 && !hooks.includes("upload")) fail("A plugin with uploaders must list the upload hook");
  if (cardActions.length > 0 && !hooks.includes("card_action")) fail("A plugin with card actions must list the card_action hook");
  if (hooks.includes("edit_image") && permissions.capturesEdit !== true) fail("The edit_image hook needs the capturesEdit permission");

  for (const uploader of uploaders) {
    if (!isObject(uploader) || typeof uploader.id !== "string" || !ITEM_ID.test(uploader.id)) fail("An uploader id is not valid");
    label(uploader.name, "Uploader name");
  }
  for (const action of cardActions) {
    if (!isObject(action) || typeof action.id !== "string" || !ITEM_ID.test(action.id)) fail("A card action id is not valid");
    label(action.label, "Card action label");
    for (const type of list(action.types, "cardActions types")) {
      if (typeof type !== "string" || !CARD_TYPES.includes(type)) fail(`Unknown card type "${String(type)}"`);
    }
  }

  checkSettings(list(manifest.settings, "settings"));
  return { id: id as string, version };
}

type Entry = { name: string, data: Buffer };

function zip(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const packed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    parts.push(local, name, packed);
    directory.push(central, name);
    offset += local.length + name.length + packed.length;
  }

  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, ...directory, end]);
}

function readEntry(folder: string, name: keyof typeof LIMITS, required: boolean): Entry | null {
  const path = join(folder, name);
  if (!existsSync(path)) {
    if (required) fail(`${path} is missing`);
    return null;
  }
  const data = readFileSync(path);
  if (data.length > LIMITS[name]) fail(`${name} is larger than ${Math.floor(LIMITS[name] / 1024)} KB`);
  return { name, data };
}

// Throws with the reason when the plugin can't be packed. Returns the path of the written file.
export function packPlugin(pluginFolder: string, outputFile?: string): string {
  const folder = resolve(pluginFolder);
  const manifestEntry = readEntry(folder, "plugin.json", true)!;
  const wasmEntry = readEntry(folder, "plugin.wasm", true)!;
  const iconEntry = readEntry(folder, "icon.png", false);
  if (!wasmEntry.data.subarray(0, 4).equals(WASM_MAGIC)) fail("plugin.wasm is not a WebAssembly module");

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestEntry.data.toString("utf-8"));
  } catch (error) {
    fail(`plugin.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { id, version } = checkManifest(manifest);

  const entries = [manifestEntry, wasmEntry, ...(iconEntry ? [iconEntry] : [])];
  const output = resolve(outputFile ?? join(folder, `${id}-${version}.rosemyne-plugin`));
  writeFileSync(output, zip(entries));
  return output;
}
