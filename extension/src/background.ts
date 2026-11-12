import { fileNameFor, isAnimated } from "./media";
import {
  BackgroundToContent, ContentToBackground, JOB_PORT, JobMessage, MIN_APP_VERSION, MediaAction, PORTS, ToastState,
  fromBase64, sendBlob,
} from "./shared";

const ACTIONS: MediaAction[] = ["copy", "upload"];
const MENU_IDS: Record<MediaAction, string> = { copy: "rosemyne-copy", upload: "rosemyne-upload" };
const MENU_TITLES: Record<MediaAction, string> = { copy: "Copy media", upload: "Upload" };
const DONE_TITLES: Record<MediaAction, string> = { copy: "Copied", upload: "Sent to Rosemyne" };

const PING_TIMEOUT_MS = 800;
const PROGRESS_INTERVAL_MS = 120;
// A file served from the browser cache finishes before this, so it never shows a download toast.
const PROGRESS_DELAY_MS = 250;

type FirefoxGlobal = {
  browser?: { clipboard?: { setImageData?: (data: ArrayBuffer, type: "png" | "jpeg") => Promise<void> } },
};

type Inbox = { next: () => Promise<JobMessage> };
type ShowToast = (toast: ToastState) => void;

let knownPort: number | null = null;

const megabytes = (bytes: number): string => (bytes / 1_048_576).toFixed(1);

function createInbox(port: chrome.runtime.Port): Inbox {
  const queue: JobMessage[] = [];
  let waiting: { resolve: (message: JobMessage) => void, reject: (error: Error) => void } | null = null;
  let closed = false;

  port.onMessage.addListener((message: JobMessage) => {
    if (waiting) {
      waiting.resolve(message);
      waiting = null;
    } else {
      queue.push(message);
    }
  });

  port.onDisconnect.addListener(() => {
    closed = true;
    waiting?.reject(new Error("The page was closed."));
  });

  function next(): Promise<JobMessage> {
    const queued = queue.shift();
    if (queued) return Promise.resolve(queued);
    if (closed) return Promise.reject(new Error("The page was closed."));
    return new Promise((resolve, reject) => {
      waiting = { resolve, reject };
    });
  }

  return { next };
}

async function receiveBlob(inbox: Inbox): Promise<Blob> {
  const parts: BlobPart[] = [];

  while (true) {
    const message = await inbox.next();
    if (message.type === "chunk") {
      parts.push(fromBase64(message.data));
    } else if (message.type === "end") {
      return new Blob(parts, { type: message.mime });
    } else if (message.type === "failed") {
      throw new Error(message.stream
        ? "This video is a stream, there is no file to copy."
        : "Couldn't read the file from the page.");
    }
  }
}

// Sites with hotlink protection only serve media to requests that name their own page as the Referer.
async function withReferer<T>(url: string, pageUrl: string, task: () => Promise<T>): Promise<T> {
  if (!/^https?:/.test(pageUrl)) return task();

  const ruleId = 1 + Math.floor(Math.random() * 1_000_000_000);
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{
      id: ruleId,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Referer", operation: "set", value: pageUrl }],
      },
      // Tab id -1 is requests made by the extension itself, so pages are never touched.
      condition: { requestDomains: [new URL(url).hostname], tabIds: [-1], resourceTypes: ["xmlhttprequest"] },
    }],
  });

  try {
    return await task();
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
  }
}

async function download(url: string, showToast: ShowToast): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "include", cache: "force-cache" });
  } catch {
    throw new Error("Couldn't download the file.");
  }
  if (!response.ok || !response.body) {
    throw new Error(`The site refused the download (${response.status}).`);
  }

  const total = Number(response.headers.get("content-length")) || null;
  const mime = response.headers.get("content-type") ?? "";
  const reader = response.body.getReader();
  const parts: BlobPart[] = [];
  const startedAt = Date.now();
  let loaded = 0;
  let lastToastAt = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    parts.push(value);
    loaded += value.length;

    const now = Date.now();
    if (now - startedAt < PROGRESS_DELAY_MS || now - lastToastAt < PROGRESS_INTERVAL_MS) continue;
    lastToastAt = now;

    showToast({
      kind: "progress",
      title: "Downloading",
      detail: total ? `${megabytes(loaded)} of ${megabytes(total)} MB` : `${megabytes(loaded)} MB`,
      percent: total ? Math.min(100, Math.round(loaded / total * 100)) : null,
    });
  }

  return new Blob(parts, { type: mime });
}

async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;

  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2d canvas in this browser");

  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

async function copyStill(blob: Blob, port: chrome.runtime.Port, inbox: Inbox): Promise<boolean> {
  try {
    const png = await toPng(blob);

    const firefoxClipboard = (globalThis as FirefoxGlobal).browser?.clipboard;
    if (firefoxClipboard?.setImageData) {
      await firefoxClipboard.setImageData(await png.arrayBuffer(), "png");
      return true;
    }

    await sendBlob(port, png);
    const reply = await inbox.next();
    return reply.type === "clipboardResult" && reply.ok;
  } catch {
    return false;
  }
}

function isOlderVersion(version: string, minimum: string): boolean {
  const parts = version.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);

  for (let index = 0; index < minimumParts.length; index++) {
    const part = parts[index] ?? 0;
    if (part !== minimumParts[index]) return part < minimumParts[index];
  }
  return false;
}

async function ping(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    const body: { app?: string, version?: string } = await response.json();
    return body.app === "rosemyne" ? body.version ?? "" : null;
  } catch {
    return null;
  }
}

async function findApp(): Promise<{ port: number, version: string } | null> {
  const candidates = knownPort === null ? PORTS : [knownPort, ...PORTS.filter(port => port !== knownPort)];

  for (const port of candidates) {
    const version = await ping(port);
    if (version !== null) {
      knownPort = port;
      return { port, version };
    }
  }

  knownPort = null;
  return null;
}

async function sendToApp(action: MediaAction, name: string, blob: Blob): Promise<void> {
  const app = await findApp();
  if (app === null) {
    throw new Error("Rosemyne isn't running, or browser extension support is off in its settings.");
  }
  if (isOlderVersion(app.version, MIN_APP_VERSION)) {
    throw new Error(`This extension needs Rosemyne ${MIN_APP_VERSION} or newer. Update the app to use it.`);
  }
  const { port } = app;

  const response = await fetch(`http://127.0.0.1:${port}/${action}?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });
  if (!response.ok) {
    throw new Error(await response.text() || `Rosemyne answered with ${response.status}.`);
  }
}

async function runJob(port: chrome.runtime.Port, tabId: number): Promise<void> {
  const inbox = createInbox(port);

  function showToast(toast: ToastState): void {
    const message: BackgroundToContent = { type: "toast", toast };
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {});
  }

  try {
    const begin = await inbox.next();
    if (begin.type !== "begin") return;

    const blob = begin.inline
      ? await receiveBlob(inbox)
      : await withReferer(begin.url, begin.pageUrl, () => download(begin.url, showToast));
    const name = await fileNameFor(begin.url, blob);

    const copiedInBrowser = begin.action === "copy"
      && begin.kind === "image"
      && !(await isAnimated(blob))
      && await copyStill(blob, port, inbox);

    if (!copiedInBrowser) {
      showToast({ kind: "busy", title: "Sending to Rosemyne", detail: name });
      await sendToApp(begin.action, name, blob);
    }

    showToast({ kind: "done", title: DONE_TITLES[begin.action], detail: name });
  } catch (error) {
    showToast({ kind: "error", title: error instanceof Error ? error.message : String(error) });
  } finally {
    port.disconnect();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const action of ACTIONS) {
      chrome.contextMenus.create({
        id: MENU_IDS[action],
        title: MENU_TITLES[action],
        contexts: ["page", "frame", "image", "video", "audio", "link", "selection"],
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message: ContentToBackground) => {
  if (message.type !== "target") return;

  for (const action of ACTIONS) {
    chrome.contextMenus.update(MENU_IDS[action], { visible: message.found });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const action = ACTIONS.find(candidate => MENU_IDS[candidate] === info.menuItemId);
  if (!action || tab?.id === undefined) return;

  const message: BackgroundToContent = { type: "start", action };
  chrome.tabs.sendMessage(tab.id, message, { frameId: info.frameId ?? 0 }).catch(() => {});
});

chrome.runtime.onConnect.addListener(port => {
  const tabId = port.sender?.tab?.id;
  if (port.name !== JOB_PORT || tabId === undefined) return;

  runJob(port, tabId);
});
