import { invoke } from "@tauri-apps/api/core";

/**
 * Raw-body invoke like `saveScreenshot`: the encoded WebP travels as binary,
 * the file name rides in a header.
 */
export async function saveVideoThumbnail(fileName: string, thumbnail: Blob): Promise<void> {
  await invoke("save_video_thumbnail", new Uint8Array(await thumbnail.arrayBuffer()), {
    headers: {
      "x-rosemyne-args": JSON.stringify({ fileName }),
    },
  });
}
