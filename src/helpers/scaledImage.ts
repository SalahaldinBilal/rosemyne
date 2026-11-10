import ScaleWorker from "./scaleWorker?worker";
import type { ScaleJob, ScaleResult } from "./scaleWorker";

// Chromium shrinks big images with plain bilinear filtering, which aliases text and thin lines,
// so card thumbnails are downscaled here instead, at the exact device-pixel size of their box.
export type ScaleMode = "cover" | "contain";

const MAX_CACHED = 240;
const cache = new Map<string, Promise<string | null>>();
const waiting = new Map<number, (image: Blob | null) => void>();
let worker: Worker | undefined;
let nextJobId = 0;

function remember(key: string, value: Promise<string | null>) {
  cache.set(key, value);
  if (cache.size <= MAX_CACHED) return;

  const oldest = cache.keys().next().value!;
  const evicted = cache.get(oldest);
  cache.delete(oldest);
  evicted?.then(url => url && URL.revokeObjectURL(url));
}

function scaleWorker(): Worker {
  if (worker) return worker;

  worker = new ScaleWorker();
  worker.onmessage = (event: MessageEvent<ScaleResult>) => {
    const { id, image, error } = event.data;
    if (error) console.error("Failed to downscale a card thumbnail", error);
    waiting.get(id)?.(image);
    waiting.delete(id);
  };
  worker.onerror = event => {
    console.error("The thumbnail worker crashed", event.message);
    worker?.terminate();
    worker = undefined;
    waiting.forEach(resolve => resolve(null));
    waiting.clear();
  };
  return worker;
}

// The fetch stays here since the custom image scheme may not be served to worker requests.
async function render(src: string, width: number, height: number, mode: ScaleMode): Promise<string | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const image = await response.blob();

    const scaled = await new Promise<Blob | null>(resolve => {
      const id = nextJobId++;
      waiting.set(id, resolve);
      scaleWorker().postMessage({ id, image, width, height, mode } satisfies ScaleJob);
    });
    return scaled ? URL.createObjectURL(scaled) : null;
  } catch (error) {
    console.error("Failed to downscale a card thumbnail", error);
    return null;
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
