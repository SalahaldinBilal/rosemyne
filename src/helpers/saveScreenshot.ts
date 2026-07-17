import { invoke } from "@tauri-apps/api/core";
import { Dimensions } from "../types/screenshot";

/**
 * Raw-body invoke , the one command bypassing `safeInvoke`: the RGBA pixels
 * travel as binary and the metadata rides in a header, so no JSON touches the
 * multi-megabyte payload.
 */
export async function saveScreenshot(id: number, position: Dimensions, image: ImageData): Promise<void> {
  await invoke("hide_and_save_screenshot", new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    headers: {
      "x-rosemyne-args": JSON.stringify({ id, position, width: image.width, height: image.height }),
    },
  });
}
