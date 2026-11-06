import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { safeInvoke } from "./safeInvoke";

// Replaces the browser's own HTML5 drag (which would carry an internal
// rosemyne-photo URL) with a native OS drag of the actual saved file.
// The OS owns the mouse during the drag, so the page gets no mouseleave or mouseup. `onEnd` is the only signal it ended.
export async function startFileDrag(event: DragEvent, file: { fileName: string, filePath: string }, onEnd?: () => void) {
  event.preventDefault();

  // No custom icon (just the OS cursor) for videos without a thumbnail yet or plain files.
  const icon = await safeInvoke("get_drag_icon", { fileName: file.fileName }).catch(() => null);
  startDrag({ item: [file.filePath], icon: icon ?? file.filePath }, () => onEnd?.())
    .catch(() => { })
    .finally(() => onEnd?.());
}
