import { Dimensions } from "../types/screenshot";
import { ImageOverlay } from "../types/imageOverlay";
import { renderFinalImage } from "./canvasRenderer";

// Module worker, spawned per render job through the `./renderWorker?worker` import in renderFinalImageAsync.ts.

export type RenderJob = {
  base: ImageBitmap,
  box: Dimensions,
  overlays: ImageOverlay[],
  layers: [number, ImageBitmap][],
};

export type RenderJobResult = {
  rect: { x: number, y: number, width: number, height: number } | null,
  pixels?: ArrayBuffer,
  error?: string,
};

// The DOM-lib typing of `self` (Window) hides the worker-scope postMessage overload.
const scope = self as unknown as Worker;

scope.onmessage = (event: MessageEvent<RenderJob>) => {
  const { base, box, overlays, layers } = event.data;

  try {
    const rendered = renderFinalImage(base, box, overlays, new Map(layers));

    if (!rendered) {
      scope.postMessage({ rect: null } satisfies RenderJobResult);
      return;
    }

    const { image, ...rect } = rendered;
    const pixels = image.data.buffer as ArrayBuffer;
    scope.postMessage({ rect, pixels } satisfies RenderJobResult, [pixels]);
  } catch (error) {
    scope.postMessage({ rect: null, error: String(error) } satisfies RenderJobResult);
  }
};
