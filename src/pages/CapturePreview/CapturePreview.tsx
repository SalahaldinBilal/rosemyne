import { createSignal, onCleanup, onMount, Show, Switch, Match } from "solid-js";
import styles from "./CapturePreview.module.scss";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { CapturePreviewPayload, PreviewClickAction } from "@core/types";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { File, Play } from "lucide-solid";

const PLACEHOLDER_SIZE = 120;

function mediaUrl(fileName: string, itemType: CapturePreviewPayload["itemType"]): string {
  return itemType === "video"
    ? `http://rosemyne-photo.localhost/thumb/${fileName}`
    : `http://rosemyne-photo.localhost/saved/${fileName}`;
}

function CapturePreview() {
  const [current, setCurrent] = createSignal<CapturePreviewPayload | null>(null);
  const [thumbnailFailed, setThumbnailFailed] = createSignal(false);
  let dismissTimer: number | undefined;

  onMount(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    const unlisten = getCurrentWebviewWindow().listen<CapturePreviewPayload>("capture-preview://show", event => {
      window.clearTimeout(dismissTimer);
      setThumbnailFailed(false);
      setCurrent(event.payload);

      if (event.payload.itemType === "file") showPlaceholder();
      if (event.payload.autoDismissMs > 0) {
        dismissTimer = window.setTimeout(close, event.payload.autoDismissMs);
      }
    });

    onCleanup(() => { unlisten.then(fn => fn()); window.clearTimeout(dismissTimer); });
  });

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
    safeInvoke("hide_capture_preview_window").catch(() => { }).finally(() => setCurrent(null));
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
            src={mediaUrl(item.fileName, item.itemType)}
            onLoad={e => onImageLoad(e.currentTarget)}
            onError={() => { setThumbnailFailed(true); showPlaceholder(); }}
          />
        </Match>
      </Switch>
    </div>}
  </Show>;
}

export default CapturePreview;
