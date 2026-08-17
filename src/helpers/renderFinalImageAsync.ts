import { Dimensions } from "../types/screenshot";
import { ImageOverlay } from "../types/imageOverlay";
import { RenderedImage, renderFinalImage } from "./canvasRenderer";
import type { RenderJob, RenderJobResult } from "./renderWorker";
import RenderWorker from "./renderWorker?worker";

function runJob(job: RenderJob, transfer: Transferable[]): Promise<RenderJobResult> {
  return new Promise((resolve, reject) => {
    const worker = new RenderWorker();

    worker.onmessage = (event: MessageEvent<RenderJobResult>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The render worker failed to start or crashed"));
    };

    worker.postMessage(job, transfer);
  });
}

/** `renderFinalImage` off the main thread; inputs snapshot at call time, so the caller can tear the session down immediately. */
export function renderFinalImageAsync(
  base: HTMLImageElement,
  box: Dimensions,
  overlays: ImageOverlay[],
  effectLayers: ReadonlyMap<number, HTMLCanvasElement>,
): Promise<RenderedImage | null> {
  const snapshot: ImageOverlay[] = structuredClone(overlays);
  // Only draw/image blit from a layer canvas; blur/pixelate re-derive from parameters.
  const layerEntries = snapshot
    .filter(overlay => overlay.type === "draw" || overlay.type === "image")
    .flatMap(overlay => {
      const layer = effectLayers.get(overlay.order);
      return layer && layer.width > 0 && layer.height > 0 ? [[overlay.order, layer] as const] : [];
    });

  const baseBitmap = createImageBitmap(base);
  const layerBitmaps = layerEntries.map(async ([order, layer]) => [order, await createImageBitmap(layer)] as [number, ImageBitmap]);

  return dispatch(snapshot, box, baseBitmap, layerBitmaps).catch(error => {
    console.error("Falling back to in-page final render:", error);
    return renderFinalImage(base, box, snapshot, new Map(layerEntries));
  });
}

async function dispatch(
  overlays: ImageOverlay[],
  box: Dimensions,
  baseBitmap: Promise<ImageBitmap>,
  layerBitmaps: Promise<[number, ImageBitmap]>[],
): Promise<RenderedImage | null> {
  const base = await baseBitmap;
  const layers = await Promise.all(layerBitmaps);

  const result = await runJob(
    { base, box, overlays, layers },
    [base, ...layers.map(([, bitmap]) => bitmap)],
  );

  if (result.error) throw new Error(result.error);
  if (!result.rect) return null;
  if (!result.pixels) throw new Error("The render worker returned no pixels");

  const { x, y, width, height } = result.rect;
  return { image: new ImageData(new Uint8ClampedArray(result.pixels), width, height), x, y, width, height };
}
