// The parts of the Extism JS PDK runtime this SDK uses. They exist as globals inside a plugin.
type ExtismOffset = number | bigint;

interface ExtismMemoryHandle {
  offset: ExtismOffset;
  readString(): string;
  readBytes(): ArrayBuffer;
  free(): void;
}

declare const Host: {
  inputString(): string;
  outputString(output: string): void;
  getFunctions(): Record<string, (...blocks: ExtismOffset[]) => ExtismOffset>;
};

declare const Memory: {
  fromString(text: string): ExtismMemoryHandle;
  fromBuffer(buffer: ArrayBufferLike): ExtismMemoryHandle;
  find(offset: ExtismOffset): ExtismMemoryHandle | null;
};

declare class TextEncoder {
  encode(text: string): Uint8Array;
}

declare class TextDecoder {
  decode(bytes: Uint8Array): string;
}

export const API_VERSION = 1;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Capture = {
  fileName: string,
  type: "image" | "video" | "file",
  dateTimeMs: number,
  width?: number,
  height?: number,
  fileSize?: number,
  url?: string,
  // Only present with the tagsRead permission.
  tags?: { [key: string]: Json },
}

export type ToastKind = "info" | "success" | "error";
export type Toast = { kind?: ToastKind, text: string };

export type Choice = { value: string | number, label: string };

// A node of a view. Props depend on `type`, see the node table in the SDK README.
export type PluginNode = {
  type: "group" | "inline" | "toggle" | "select" | "segmented" | "number" | "duration" | "fileSize" | "dimension"
    | "text" | "template" | "button" | "label" | "badge" | "progress" | "emptyState" | "link" | "image",
  id?: string,
  children?: PluginNode[],
  [prop: string]: unknown,
}

export type UploadResult = { url: string, deletionUrl?: string };

export type UiResponse = {
  tree?: PluginNode[],
  toast?: Toast,
  // Closes the modal the event came from.
  close?: boolean,
  // Asks for ui_render again after this long while the view stays open. 500 ms at least.
  refreshAfterMs?: number,
}

export type UiEvent = {
  // "settings", or "modal:<actionId>".
  view: string,
  id: string,
  type: "change" | "click",
  value?: Json,
}

export type ModalAction = { id: string, label: string, variant?: "primary" | "secondary" | "danger-solid" };

export type CardActionResponse = {
  modal?: { title: string, tree: PluginNode[], actions?: ModalAction[] },
  toast?: Toast,
}

// Hooks run to completion with no event loop, so they can't be async.
export type Hooks = {
  on_capture_saved?: (input: { capture: Capture }) => void,
  edit_image?: (input: { width: number, height: number }) => void,
  upload?: (input: { uploaderId: string, capture: Capture }) => UploadResult,
  ui_render?: (input: { view: string }) => UiResponse,
  ui_event?: (input: UiEvent) => UiResponse | void,
  card_action?: (input: { actionId: string, capture: Capture }) => CardActionResponse | void,
}

type Handler = (input: never) => unknown;

function exported(handler: Handler): () => number {
  return function hook(): number {
    const output = (handler as (input: unknown) => unknown)(JSON.parse(Host.inputString()));
    Host.outputString(JSON.stringify(output ?? null));
    return 0;
  };
}

// The default export of a plugin's entry file. Every hook also has to be listed in plugin.json.
export function definePlugin(hooks: Hooks): Record<string, () => number> {
  const exports: Record<string, () => number> = {};
  for (const [name, handler] of Object.entries(hooks)) {
    if (handler) exports[name] = exported(handler as Handler);
  }
  return exports;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Offset 0 stands for an empty block in both directions.
function block(data: string | Uint8Array): ExtismMemoryHandle | null {
  if (data.length === 0) return null;
  if (typeof data === "string") return Memory.fromString(data);
  return Memory.fromBuffer(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

function take(offset: ExtismOffset): Uint8Array {
  if (Number(offset) === 0) return new Uint8Array(0);
  const memory = Memory.find(offset);
  if (!memory) return new Uint8Array(0);
  const bytes = new Uint8Array(memory.readBytes());
  memory.free();
  return bytes;
}

function call(name: string, ...data: Array<string | Uint8Array>): Uint8Array {
  const blocks = data.map(block);
  const output = take(Host.getFunctions()[name](...blocks.map(memory => memory ? memory.offset : 0)));
  for (const memory of blocks) memory?.free();
  return output;
}

function parse<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
}

export type Pixels = { width: number, height: number, rgba: Uint8Array };

export type Part = {
  name: string,
  text?: string,
  // The current capture's file, sent by Rosemyne without passing through the plugin.
  captureFile?: boolean,
  // The request's own `bytes`. One part per request can use them.
  bytes?: boolean,
  fileName?: string,
  mime?: string,
}

export type HttpBody =
  | { type: "none" }
  | { type: "text", text: string }
  | { type: "json", json: Json }
  | { type: "bytes" }
  | { type: "captureFile" }
  | { type: "multipart", parts: Part[] };

export type HttpRequest = {
  method?: string,
  url: string,
  headers?: Array<[string, string]>,
  body?: HttpBody,
  timeoutMs?: number,
  // Sent as the body for `{ type: "bytes" }`, or as the multipart part marked `bytes`.
  bytes?: Uint8Array,
}

export type HttpResponse = {
  status: number,
  ok: boolean,
  headers: Array<[string, string]>,
  body: Uint8Array,
  text(): string,
  json<T = Json>(): T,
}

type HttpReply = { error?: string, status?: number, headers?: Array<[string, string]> };

// A call the plugin has no permission for, or one made outside the hook it belongs to, ends the hook with an error.
export const host = {
  log(level: "debug" | "info" | "warn" | "error", text: string): void {
    call("log", JSON.stringify({ level, text }));
  },

  kvGet(key: string): Uint8Array | null {
    const output = call("kv_get", key);
    return output[0] === 1 ? output.subarray(1) : null;
  },

  kvGetText(key: string): string | null {
    const value = host.kvGet(key);
    return value === null ? null : decoder.decode(value);
  },

  kvSet(key: string, value: string | Uint8Array): void {
    call("kv_set", key, value);
  },

  kvDelete(key: string): void {
    call("kv_delete", key);
  },

  kvKeys(prefix = ""): string[] {
    return parse(call("kv_keys", prefix));
  },

  // The value of a static setting from plugin.json, or its declared default. null when it has neither.
  setting<T = Json>(id: string): T | null {
    return parse(call("settings_get", id));
  },

  // The saved file of the capture this hook runs for, as stored on disk.
  captureFile(): Uint8Array {
    return call("capture_file");
  },

  // RGBA pixels of the current capture, scaled down so no side is longer than maxSide.
  capturePixels(maxSide?: number): Pixels {
    const output = call("capture_pixels", JSON.stringify({ maxSide: maxSide ?? null }));
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
    return { width: view.getUint32(0, true), height: view.getUint32(4, true), rgba: output.subarray(8) };
  },

  // Replaces the image being saved. Only inside edit_image.
  setImagePixels(width: number, height: number, rgba: Uint8Array): void {
    call("image_set_pixels", JSON.stringify({ width, height }), rgba);
  },

  tags(): { [key: string]: Json } {
    return parse(call("tags_get"));
  },

  // Replaces what sits under the plugin's tagKey on the current capture. null removes it.
  setTags(value: Json): void {
    call("tags_set", JSON.stringify(value));
  },

  clipboardWriteText(text: string): void {
    call("clipboard_write_text", text);
  },

  // Shows a notification in Rosemyne's main window. At most one per 2 seconds gets through.
  toast(kind: ToastKind, text: string): void {
    call("toast", JSON.stringify({ kind, text }));
  },

  // Stores an image for an `image` node. PNG, JPEG, WebP or GIF, 8 MB per plugin in total.
  assetPut(id: string, mime: string, bytes: Uint8Array): void {
    call("asset_put", JSON.stringify({ id, mime }), bytes);
  },

  // Throws on a network failure or a refused host. An HTTP error status is still a response.
  http(request: HttpRequest): HttpResponse {
    const { bytes, ...rest } = request;
    const reply = parse<HttpReply>(call("http_request", JSON.stringify(rest), bytes ?? new Uint8Array(0)));
    if (reply.error !== undefined) throw new Error(reply.error);

    const body = call("http_response_body");
    const status = reply.status ?? 0;
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: reply.headers ?? [],
      body,
      text: () => decoder.decode(body),
      json: <T = Json>() => JSON.parse(decoder.decode(body)) as T,
    };
  },
};
