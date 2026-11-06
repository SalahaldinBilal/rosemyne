import { createMemo, createSignal, onCleanup, onMount, Show, Switch, Match } from "solid-js";
import styles from "./CapturePreview.module.scss";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { startFileDrag } from "@core/helpers/fileDrag";
import { CapturePreviewPayload, PreviewClickAction, PreviewCorner } from "@core/types";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CircleCheck, File, Play } from "lucide-solid";

const PLACEHOLDER_SIZE = 120;
const EXIT_MS = 160;

const ORIGINS: Record<PreviewCorner, string> = {
  topLeft: "top left",
  topRight: "top right",
  bottomLeft: "bottom left",
  bottomRight: "bottom right",
};

const ACTION_LABELS: Record<PreviewClickAction, string | null> = {
  nothing: null,
  close: "Close",
  openFile: "Open",
  openFolder: "Show in folder",
  copyFile: "Copy",
  copyLink: "Copy link",
};

function mediaUrl(fileName: string, itemType: CapturePreviewPayload["itemType"]): string {
  return itemType === "video"
    ? `http://rosemyne-photo.localhost/thumb/${fileName}`
    : `http://rosemyne-photo.localhost/saved/${fileName}`;
}

// The window is sized exactly to this content (no margin, so it can't block clicks), so every
// animation stays inside its own bounds and there's no outer shadow.
function CapturePreview() {
  const [current, setCurrent] = createSignal<CapturePreviewPayload | null>(null);
  const [thumbnailFailed, setThumbnailFailed] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  let dismissTimer: number | undefined;
  let exitTimer: number | undefined;
  let remainingMs = 0;
  let startedAt = 0;

  const origin = createMemo(() => ORIGINS[current()?.corner ?? "bottomRight"]);
  const status = createMemo(() => {
    const item = current();
    if (!item) return null;
    if (item.url) return "Uploaded";
    if (item.itemType === "video") return "Recording saved";
    return null;
  });
  const showCountdown = createMemo(() => (current()?.autoDismissMs ?? 0) > 0 && (current()?.showCountdown ?? true));
  const leftLabel = createMemo(() => ACTION_LABELS[current()?.leftClickAction ?? "nothing"]);
  const rightLabel = createMemo(() => ACTION_LABELS[current()?.rightClickAction ?? "nothing"]);
  const imageSrc = createMemo(() => {
    const item = current();
    return item ? mediaUrl(item.fileName, item.itemType) : "";
  });

  function startDismiss(ms: number) {
    window.clearTimeout(dismissTimer);
    remainingMs = ms;
    startedAt = Date.now();
    dismissTimer = window.setTimeout(close, ms);
  }

  onMount(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    const unlisten = getCurrentWebviewWindow().listen<CapturePreviewPayload>("capture-preview://show", event => {
      window.clearTimeout(dismissTimer);
      window.clearTimeout(exitTimer);
      setLeaving(false);
      setPaused(false);
      setThumbnailFailed(false);
      setCurrent(event.payload);

      if (event.payload.itemType === "file") showPlaceholder();
      if (event.payload.autoDismissMs > 0) startDismiss(event.payload.autoDismissMs);
    });

    onCleanup(() => {
      unlisten.then(fn => fn());
      window.clearTimeout(dismissTimer);
      window.clearTimeout(exitTimer);
    });
  });

  // Hovering pauses the countdown, so it doesn't close while being read. Mouse moves pause too,
  // since after a file drag the page still thinks the mouse is inside and no new mouseenter comes.
  function pause() {
    if (paused() || !current() || current()!.autoDismissMs <= 0 || leaving()) return;
    window.clearTimeout(dismissTimer);
    remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
    setPaused(true);
  }

  function resume() {
    if (!paused()) return;
    setPaused(false);
    startDismiss(remainingMs);
  }

  function showPlaceholder() {
    safeInvoke("show_capture_preview_window", { width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE }).catch(() => { });
  }

  function onImageLoad(image: HTMLImageElement) {
    const item = current();
    if (!item) return;

    const scale = Math.min(1, item.maxWidth / image.naturalWidth, item.maxHeight / image.naturalHeight);
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * scale * ratio));

    safeInvoke("show_capture_preview_window", { width, height }).catch(() => { });
  }

  function close() {
    window.clearTimeout(dismissTimer);
    if (leaving()) return;
    setLeaving(true);
    exitTimer = window.setTimeout(() => {
      safeInvoke("hide_capture_preview_window").catch(() => { }).finally(() => {
        setCurrent(null);
        setLeaving(false);
      });
    }, EXIT_MS);
  }

  async function performAction(action: PreviewClickAction) {
    const item = current();
    if (!item) return;

    switch (action) {
      case "close":
        return close();
      case "openFile":
        return safeInvoke("open_file", { fileName: item.fileName }).catch(() => { });
      case "openFolder":
        return safeInvoke("show_in_folder", { fileName: item.fileName }).catch(() => { });
      case "copyFile":
        return (item.itemType === "image"
          ? safeInvoke("copy_screenshot_to_clipboard", { fileName: item.fileName })
          : safeInvoke("copy_file_to_clipboard", { fileName: item.fileName })
        ).catch(() => { });
      case "copyLink":
        return item.url ? safeInvoke("copy_text_to_clipboard", { text: item.url }).catch(() => { }) : undefined;
      case "nothing":
        return;
    }
  }

  return <Show when={current()} keyed>
    {item => <div
      class={styles.CapturePreview}
      classList={{ [styles.Leaving]: leaving() }}
      style={{ "transform-origin": origin() }}
      draggable="true"
      onDragStart={event => startFileDrag(event, item, resume)}
      onMouseEnter={pause}
      onMouseMove={pause}
      onMouseLeave={resume}
      onClick={() => performAction(item.leftClickAction)}
      onContextMenu={event => { event.preventDefault(); performAction(item.rightClickAction); }}
    >
      <Switch>
        <Match when={item.itemType === "file" || thumbnailFailed()}>
          <div class={styles.Placeholder}>
            {item.itemType === "video" ? <Play size={32} /> : <File size={32} />}
          </div>
        </Match>
        <Match when={true}>
          <img
            src={imageSrc()}
            draggable={false}
            onLoad={e => onImageLoad(e.currentTarget)}
            onError={() => { setThumbnailFailed(true); showPlaceholder(); }}
          />
        </Match>
      </Switch>

      <Show when={status()}>
        {text => <span class={styles.Status}><CircleCheck size={12} />{text()}</span>}
      </Show>

      <Show when={leftLabel() || rightLabel()}>
        <div class={styles.Hover}>
          <span>{leftLabel() ? `Click: ${leftLabel()}` : ""}</span>
          <span>{rightLabel() ? `Right click: ${rightLabel()}` : ""}</span>
        </div>
      </Show>

      <Show when={showCountdown()}>
        <span
          class={styles.Countdown}
          classList={{ [styles.Paused]: paused() }}
          style={{ "animation-duration": `${item.autoDismissMs}ms` }}
          data-keep-motion
        />
      </Show>
    </div>}
  </Show>;
}

export default CapturePreview;
