// Chromium shrinks big images with plain bilinear filtering, which aliases text and thin lines,
// so card thumbnails are downscaled here instead, at the exact device-pixel size of their box.
export type ScaleMode = "cover" | "contain";

const MAX_CACHED = 240;
const cache = new Map<string, Promise<string | null>>();

function remember(key: string, value: Promise<string | null>) {
  cache.set(key, value);
  if (cache.size <= MAX_CACHED) return;

  const oldest = cache.keys().next().value!;
  const evicted = cache.get(oldest);
  cache.delete(oldest);
  evicted?.then(url => url && URL.revokeObjectURL(url));
}

function canvasOf(width: number, height: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return [canvas, context];
}

// Halving with bilinear smoothing averages every 2x2 block, so repeating it until the last step is under 2x
// samples every source pixel, unlike one big bilinear shrink that skips most of them.
async function render(src: string, boxWidth: number, boxHeight: number, mode: ScaleMode): Promise<string | null> {
  let source: ImageBitmap | undefined;
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    source = await createImageBitmap(await response.blob());

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
    return URL.createObjectURL(await out.convertToBlob({ type: "image/png" }));
  } catch (error) {
    console.error("Failed to downscale a card thumbnail", error);
    return null;
  } finally {
    source?.close();
  }
}

// A downscaled copy for a box of this device-pixel size, or null when the original should be shown as-is.
export function scaledImageUrl(src: string, width: number, height: number, mode: ScaleMode): Promise<string | null> {
  const key = `${src}|${width}x${height}|${mode}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const pending = render(src, width, height, mode);
  remember(key, pending);
  return pending;
}
