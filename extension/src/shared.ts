// Keep in step with PORTS in src-tauri/src/browser_extension/mod.rs.
export const PORTS = [41873, 37619, 28463];

// The first app version with the extension server. Raise it only when the app side changes in a way this extension needs.
export const MIN_APP_VERSION = "0.3.4";

export const JOB_PORT = "rosemyne-job";

const CHUNK_BYTES = 768 * 1024;

export type MediaAction = "copy" | "upload";
export type MediaKind = "image" | "video";
export type MediaTarget = { url: string, kind: MediaKind };

export type ToastState =
  | { kind: "progress", title: string, detail: string, percent: number | null }
  | { kind: "busy", title: string, detail: string }
  | { kind: "done", title: string, detail: string }
  | { kind: "error", title: string };

export type ContentToBackground = { type: "target", found: boolean };

export type BackgroundToContent =
  | { type: "start", action: MediaAction }
  | { type: "toast", toast: ToastState };

export type JobMessage =
  | { type: "begin", action: MediaAction, url: string, pageUrl: string, kind: MediaKind, inline: boolean }
  | { type: "chunk", data: string }
  | { type: "end", mime: string }
  | { type: "failed", stream: boolean }
  | { type: "clipboardResult", ok: boolean };

export function postJob(port: chrome.runtime.Port, message: JobMessage): void {
  port.postMessage(message);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// Extension messages are JSON only in Chromium, so bytes cross as base64 chunks.
export async function sendBlob(port: chrome.runtime.Port, blob: Blob): Promise<void> {
  for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
    postJob(port, { type: "chunk", data: toBase64(bytes) });
  }
  postJob(port, { type: "end", mime: blob.type });
}
