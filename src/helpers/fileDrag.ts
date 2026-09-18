import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { safeInvoke } from "./safeInvoke";

// Replaces the browser's own HTML5 drag (which would carry an internal
// rosemyne-photo URL) with a native OS drag of the actual saved file.
export async function startFileDrag(event: DragEvent, file: { fileName: string, filePath: string }) {
  event.preventDefault();

  // No custom icon (just the OS cursor) for videos without a thumbnail yet or plain files.
  const icon = await safeInvoke("get_drag_icon", { fileName: file.fileName }).catch(() => null);
  startDrag({ item: [file.filePath], icon: icon ?? file.filePath }).catch(() => { });
}
