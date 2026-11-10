import type { ScaleMode } from "./scaledImage";

// Module worker behind scaledImage.ts, through its `./scaleWorker?worker` import.

export type ScaleJob = { id: number, image: Blob, width: number, height: number, mode: ScaleMode };
export type ScaleResult = { id: number, image: Blob | null, error?: string };

// The DOM-lib typing of `self` (Window) hides the worker-scope postMessage overload.
const scope = self as unknown as Worker;

function canvasOf(width: number, height: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return [canvas, context];
}

// Halving with bilinear smoothing averages every 2x2 block, so repeating it until the last step is under 2x
// samples every source pixel, unlike one big bilinear shrink that skips most of them.
async function scaleDown(image: Blob, boxWidth: number, boxHeight: number, mode: ScaleMode): Promise<Blob | null> {
  const source = await createImageBitmap(image);
  try {
    const scale = mode === "cover"
      ? Math.max(boxWidth / source.width, boxHeight / source.height)
      : Math.min(boxWidth / source.width, boxHeight / source.height);
    // Under 2x the browser's own scaling looks fine, so the original is used as-is.
    if (scale >= 0.5) return null;

    // cover crops the source to the box's aspect, contain keeps all of it and shrinks the output instead.
    const width = mode === "cover" ? boxWidth : Math.max(1, Math.round(source.width * scale));
    const height = mode === "cover" ? boxHeight : Math.max(1, Math.round(source.height * scale));
    let cropWidth = mode === "cover" ? Math.min(source.width, Math.round(width / scale)) : source.width;
    let cropHeight = mode === "cover" ? Math.min(source.height, Math.round(height / scale)) : source.height;
    let [canvas, context] = canvasOf(cropWidth, cropHeight);
    context.drawImage(source, (source.width - cropWidth) / 2, (source.height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    while (cropWidth / 2 >= width && cropHeight / 2 >= height) {
      const halfWidth = Math.round(cropWidth / 2), halfHeight = Math.round(cropHeight / 2);
      const [next, nextContext] = canvasOf(halfWidth, halfHeight);
      nextContext.drawImage(canvas, 0, 0, halfWidth, halfHeight);
      [canvas, context, cropWidth, cropHeight] = [next, nextContext, halfWidth, halfHeight];
    }

    const [out, outContext] = canvasOf(width, height);
    outContext.drawImage(canvas, 0, 0, width, height);
    return await out.convertToBlob({ type: "image/png" });
  } finally {
    source.close();
  }
}

scope.onmessage = async (event: MessageEvent<ScaleJob>) => {
  const { id, image, width, height, mode } = event.data;
  try {
    scope.postMessage({ id, image: await scaleDown(image, width, height, mode) } satisfies ScaleResult);
  } catch (error) {
    scope.postMessage({ id, image: null, error: String(error) } satisfies ScaleResult);
  }
};
