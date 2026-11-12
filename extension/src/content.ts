import {
  BackgroundToContent, ContentToBackground, JOB_PORT, JobMessage, MediaAction, MediaTarget, ToastState, fromBase64,
  postJob, sendBlob,
} from "./shared";

const DONE_LIFETIME_MS = 2000;
const ERROR_LIFETIME_MS = 5000;
const LEAVE_MS = 180;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ICON_PATHS = {
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6 6l12 12M18 6L6 18",
};

const TOAST_CSS = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
.toast {
  --color: #7b6cf6; --soft: rgb(123 108 246 / 0.14); --icon: #b7aeff;
  position: relative; display: flex; align-items: center; gap: 10px;
  box-sizing: border-box; width: 320px; max-width: calc(100vw - 32px); padding: 10px 12px; overflow: hidden;
  background: #24242c; border: 1px solid #3b3b46; border-radius: 12px;
  box-shadow: 0 28px 70px -18px rgb(0 0 0 / 0.75), 0 0 0 1px rgb(0 0 0 / 0.25);
  color: #ededf2; font: 13px/1.35 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  cursor: default; animation: toast-in 280ms cubic-bezier(0.3, 1.45, 0.55, 1);
}
.toast.ok { --color: #3fcf8e; --soft: rgb(63 207 142 / 0.14); --icon: #3fcf8e; }
.toast.err { --color: #f25555; --soft: rgb(242 85 85 / 0.14); --icon: #f25555; }
.toast.leaving { pointer-events: none; animation: toast-out ${LEAVE_MS}ms cubic-bezier(0.55, 0, 0.75, 0.2) forwards; }
.ico {
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 22px; height: 22px; border-radius: 7px; background: var(--soft); color: var(--icon);
}
.ico svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.spinner {
  box-sizing: border-box; width: 12px; height: 12px; border-radius: 50%;
  border: 1.5px solid rgb(255 255 255 / 0.14); border-top-color: #7b6cf6;
  animation: turn 0.7s linear infinite;
}
.msg { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; word-break: break-word; }
.sub { color: #a4a4b2; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pct { flex-shrink: 0; color: #a4a4b2; font-size: 12px; font-variant-numeric: tabular-nums; }
.bar { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--color); opacity: 0.7; }
.bar.sweep { width: 38%; animation: sweep 1.2s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
.bar.life { animation: life linear forwards; }
@keyframes toast-in { from { opacity: 0; transform: translateX(18px) scale(0.98); } }
@keyframes toast-out { to { opacity: 0; transform: translateX(12px); } }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(270%); } }
@keyframes life { from { width: 100%; } to { width: 0; } }
@keyframes turn { to { transform: rotate(360deg); } }
`;

type FirefoxContentGlobal = { content?: { fetch?: typeof fetch } };

let lastTarget: MediaTarget | null = null;
let toastHost: HTMLElement | null = null;
let toastElement: HTMLElement | null = null;
let toastTimer: number | undefined;

function backgroundImageUrl(element: Element): string | null {
  const match = /url\("?(.+?)"?\)/.exec(getComputedStyle(element).backgroundImage);
  return match ? match[1] : null;
}

function mediaAt(x: number, y: number): MediaTarget | null {
  const elements = document.elementsFromPoint(x, y);

  for (const element of elements) {
    if (element instanceof HTMLVideoElement && element.currentSrc) {
      return { url: element.currentSrc, kind: "video" };
    }
    if (element instanceof HTMLImageElement && element.currentSrc) {
      return { url: element.currentSrc, kind: "image" };
    }
  }

  // Sites that draw photos as CSS backgrounds. Checked last so an icon over a video doesn't win.
  for (const element of elements) {
    const url = backgroundImageUrl(element);
    if (url) return { url, kind: "image" };
  }

  return null;
}

function rememberTarget(event: MouseEvent): void {
  lastTarget = mediaAt(event.clientX, event.clientY);

  const message: ContentToBackground = { type: "target", found: lastTarget !== null };
  // Throws in a tab left open across an extension reload.
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    lastTarget = null;
  }
}

function icon(name: keyof typeof ICON_PATHS): SVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

function span(className: string, ...children: (Node | string)[]): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.append(...children);
  return element;
}

function toastRoot(): HTMLElement {
  if (toastElement?.isConnected) return toastElement;

  toastHost = document.createElement("div");
  const shadow = toastHost.attachShadow({ mode: "closed" });
  // A constructed sheet, since a page's CSP can block inline <style> elements.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(TOAST_CSS);
  shadow.adoptedStyleSheets = [sheet];

  toastElement = document.createElement("div");
  toastElement.addEventListener("click", dismissToast);
  shadow.append(toastElement);
  document.documentElement.append(toastHost);
  return toastElement;
}

function dismissToast(): void {
  window.clearTimeout(toastTimer);
  toastElement?.classList.add("leaving");
  toastTimer = window.setTimeout(() => {
    toastHost?.remove();
    toastHost = null;
    toastElement = null;
  }, LEAVE_MS);
}

function showToast(toast: ToastState): void {
  window.clearTimeout(toastTimer);
  const root = toastRoot();
  root.className = toast.kind === "done" ? "toast ok" : toast.kind === "error" ? "toast err" : "toast";

  const iconChild = toast.kind === "busy" ? span("spinner")
    : icon(toast.kind === "progress" ? "download" : toast.kind === "done" ? "check" : "cross");
  const message = span("msg", toast.title);
  if (toast.kind !== "error" && toast.detail) message.append(span("sub", toast.detail));

  const bar = document.createElement("i");
  bar.className = "bar";
  root.replaceChildren(span("ico", iconChild), message);

  if (toast.kind === "progress" && toast.percent !== null) {
    root.append(span("pct", `${toast.percent}%`));
    bar.style.width = `${toast.percent}%`;
  } else if (toast.kind === "progress" || toast.kind === "busy") {
    bar.classList.add("sweep");
  } else {
    const lifetime = toast.kind === "done" ? DONE_LIFETIME_MS : ERROR_LIFETIME_MS;
    bar.classList.add("life");
    bar.style.animationDuration = `${lifetime}ms`;
    toastTimer = window.setTimeout(dismissToast, lifetime);
  }

  root.append(bar);
}

async function writePngToClipboard(png: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}

// Only the page can read its own blob: and data: URLs, so those bytes are sent from here.
async function sendInline(port: chrome.runtime.Port, target: MediaTarget): Promise<void> {
  try {
    const page = (globalThis as FirefoxContentGlobal).content;
    const response = await (page?.fetch ? page.fetch(target.url) : fetch(target.url));
    await sendBlob(port, await response.blob());
  } catch {
    postJob(port, { type: "failed", stream: target.kind === "video" && target.url.startsWith("blob:") });
  }
}

function startJob(action: MediaAction, target: MediaTarget): void {
  const port = chrome.runtime.connect({ name: JOB_PORT });
  const inline = /^(blob|data):/.test(target.url);
  const pngParts: BlobPart[] = [];

  port.onMessage.addListener(async (message: JobMessage) => {
    if (message.type === "chunk") {
      pngParts.push(fromBase64(message.data));
    } else if (message.type === "end") {
      const ok = await writePngToClipboard(new Blob(pngParts, { type: "image/png" }));
      postJob(port, { type: "clipboardResult", ok });
    }
  });

  postJob(port, { type: "begin", action, url: target.url, pageUrl: location.href, kind: target.kind, inline });
  if (inline) sendInline(port, target);
}

window.addEventListener("mousedown", event => {
  if (event.button === 2) rememberTarget(event);
}, { capture: true });
window.addEventListener("contextmenu", rememberTarget, { capture: true });

chrome.runtime.onMessage.addListener((message: BackgroundToContent) => {
  if (message.type === "start" && lastTarget) {
    startJob(message.action, lastTarget);
  } else if (message.type === "toast" && window.top === window) {
    showToast(message.toast);
  }
});
