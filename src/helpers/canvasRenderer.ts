import { Dimensions } from "../types/screenshot";
import { BlurImageOverlay, BoxImageOverlay, ImageOverlay, PixelateImageOverlay, TextImageOverlay } from "../types/imageOverlay";
import { effectIntensity } from "./index";

export type RenderedImage = { image: ImageData, x: number, y: number, width: number, height: number };

type Scratch = { canvas: HTMLCanvasElement | null, ctx: CanvasRenderingContext2D | null };

const composeScratch: Scratch = { canvas: null, ctx: null };
const kernelScratch: Scratch = { canvas: null, ctx: null };
const pixelScratch: Scratch = { canvas: null, ctx: null };

/** Reuses a module-level canvas; setting width/height also clears it. */
function scratchContext(scratch: Scratch, width: number, height: number): CanvasRenderingContext2D {
  if (!scratch.canvas) {
    scratch.canvas = document.createElement("canvas");
    scratch.ctx = scratch.canvas.getContext("2d")!;
  }

  scratch.canvas.width = width;
  scratch.canvas.height = height;
  return scratch.ctx!;
}

/** Reusable scratch for composing a preview effect's region + margin. */
export function composeScratchContext(width: number, height: number): CanvasRenderingContext2D {
  return scratchContext(composeScratch, width, height);
}

/** How far outside its own rect an overlay samples the image. */
export function effectMargin(overlay: ImageOverlay): number {
  if (overlay.type === "blur") return effectIntensity(overlay.attributes.intensity.value) * 3 + 2;
  if (overlay.type === "pixelate") return Math.max(effectIntensity(overlay.attributes.intensity.value), 1);
  return 0;
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(word => word.length > 0);
    let currentLine = "";

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;

      if (currentLine && ctx.measureText(candidate).width > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }

    lines.push(currentLine);
  }

  return lines;
}

/** Fill covering the whole rect with the border ring painted on top, clipped to the rect. */
export function drawBoxOverlay(ctx: CanvasRenderingContext2D, overlay: BoxImageOverlay, offsetX: number, offsetY: number) {
  const dims = overlay.dimensions;
  const x = Math.round(dims.x) - offsetX;
  const y = Math.round(dims.y) - offsetY;
  const width = Math.round(dims.width);
  const height = Math.round(dims.height);
  if (width <= 0 || height <= 0) return;

  const thickness = effectIntensity(overlay.attributes.borderThickness.value);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.fillStyle = overlay.attributes.color.value;
  ctx.fillRect(x, y, width, height);

  if (thickness > 0) {
    ctx.strokeStyle = overlay.attributes.borderColor.value;
    ctx.lineWidth = thickness;
    ctx.strokeRect(x + thickness / 2, y + thickness / 2, width - thickness, height - thickness);
  }

  ctx.restore();
}

export function drawTextOverlay(ctx: CanvasRenderingContext2D, overlay: TextImageOverlay, offsetX: number, offsetY: number) {
  const dims = overlay.dimensions;
  const x = Math.round(dims.x) - offsetX;
  const y = Math.round(dims.y) - offsetY;
  const width = Math.round(dims.width);
  const height = Math.round(dims.height);
  const size = overlay.attributes.size.value;
  if (width <= 0 || height <= 0 || !Number.isFinite(size) || size <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.font = `${size}px ${overlay.attributes.font.value}`;
  ctx.fillStyle = overlay.attributes.color.value;
  ctx.textBaseline = "top";

  const lineHeight = size * 1.2;
  wrapText(ctx, overlay.attributes.text.value, width)
    .forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));

  ctx.restore();
}

/**
 * Applies a blur/pixelate to the overlay's rect on `scene` in place, sampling
 * an expanded surrounding area. `originX/originY` are the absolute capture
 * coordinates of the scene canvas' top-left, so the pixelate grid stays
 * anchored to the capture regardless of what window is being rendered.
 */
export function applyEffectRegion(
  scene: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  overlay: BlurImageOverlay | PixelateImageOverlay,
) {
  const bounds = scene.canvas;
  const dims = overlay.dimensions;
  const left = Math.max(Math.round(dims.x) - originX, 0);
  const top = Math.max(Math.round(dims.y) - originY, 0);
  const right = Math.min(Math.round(dims.x + dims.width) - originX, bounds.width);
  const bottom = Math.min(Math.round(dims.y + dims.height) - originY, bounds.height);
  if (left >= right || top >= bottom) return;

  const intensity = effectIntensity(overlay.attributes.intensity.value);

  if (overlay.type === "blur") {
    if (intensity <= 0) return;

    const margin = intensity * 3 + 2;
    const sampleLeft = Math.max(left - margin, 0);
    const sampleTop = Math.max(top - margin, 0);
    const sampleWidth = Math.min(right + margin, bounds.width) - sampleLeft;
    const sampleHeight = Math.min(bottom + margin, bounds.height) - sampleTop;

    const sample = scratchContext(kernelScratch, sampleWidth, sampleHeight);
    sample.drawImage(bounds, sampleLeft, sampleTop, sampleWidth, sampleHeight, 0, 0, sampleWidth, sampleHeight);

    scene.save();
    scene.beginPath();
    scene.rect(left, top, right - left, bottom - top);
    scene.clip();
    scene.filter = `blur(${intensity}px)`;
    scene.drawImage(sample.canvas!, 0, 0, sampleWidth, sampleHeight, sampleLeft, sampleTop, sampleWidth, sampleHeight);
    scene.filter = "none";
    scene.restore();
    return;
  }

  const block = intensity;
  if (block <= 1) return;

  const alignedLeft = Math.floor((originX + left) / block) * block - originX;
  const alignedTop = Math.floor((originY + top) / block) * block - originY;
  const columns = Math.ceil((originX + right) / block) - Math.floor((originX + left) / block);
  const rows = Math.ceil((originY + bottom) / block) - Math.floor((originY + top) / block);

  const down = scratchContext(pixelScratch, columns, rows);
  down.imageSmoothingEnabled = true;
  down.drawImage(bounds, alignedLeft, alignedTop, columns * block, rows * block, 0, 0, columns, rows);

  scene.save();
  scene.beginPath();
  scene.rect(left, top, right - left, bottom - top);
  scene.clip();
  scene.imageSmoothingEnabled = false;
  scene.drawImage(down.canvas!, 0, 0, columns, rows, alignedLeft, alignedTop, columns * block, rows * block);
  scene.imageSmoothingEnabled = true;
  scene.restore();
}

/**
 * Draws one overlay onto a composed scene: boxes/text vectorially, effects by
 * blitting their already-rendered preview canvas from the registry.
 */
export function drawOverlayOnto(
  ctx: CanvasRenderingContext2D,
  overlay: ImageOverlay,
  originX: number,
  originY: number,
  effectLayers: Map<number, HTMLCanvasElement>,
) {
  switch (overlay.type) {
    case "box":
      return drawBoxOverlay(ctx, overlay, originX, originY);
    case "text":
      return drawTextOverlay(ctx, overlay, originX, originY);
    default: {
      const layer = effectLayers.get(overlay.order);
      if (!layer || layer.width === 0 || layer.height === 0) return;

      const regionX = Math.max(Math.round(overlay.dimensions.x), 0);
      const regionY = Math.max(Math.round(overlay.dimensions.y), 0);
      ctx.drawImage(layer, regionX - originX, regionY - originY);
    }
  }
}

/**
 * The save compositor: renders the selection with every overlay applied in
 * stacking order, on a scene grown by the total effect margin so effects
 * sample beyond the crop exactly like the preview. Returns the cropped pixels
 * plus the actual (clamped, rounded) crop rect.
 */
export function renderFinalImage(base: HTMLImageElement, box: Dimensions, overlays: ImageOverlay[], effectLayers: Map<number, HTMLCanvasElement>): RenderedImage | null {
  const captureWidth = base.naturalWidth;
  const captureHeight = base.naturalHeight;

  const left = Math.min(Math.max(Math.round(box.x), 0), captureWidth);
  const top = Math.min(Math.max(Math.round(box.y), 0), captureHeight);
  const right = Math.min(Math.max(Math.round(box.x + box.width), left), captureWidth);
  const bottom = Math.min(Math.max(Math.round(box.y + box.height), top), captureHeight);
  if (right - left < 1 || bottom - top < 1) return null;

  const margin = overlays.reduce((sum, overlay) => sum + effectMargin(overlay), 0);
  const sceneLeft = Math.max(left - margin, 0);
  const sceneTop = Math.max(top - margin, 0);
  const sceneWidth = Math.min(right + margin, captureWidth) - sceneLeft;
  const sceneHeight = Math.min(bottom + margin, captureHeight) - sceneTop;

  const scene = document.createElement("canvas");
  scene.width = sceneWidth;
  scene.height = sceneHeight;
  const ctx = scene.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(base, sceneLeft, sceneTop, sceneWidth, sceneHeight, 0, 0, sceneWidth, sceneHeight);

  for (const overlay of overlays) {
    switch (overlay.type) {
      case "box":
        drawBoxOverlay(ctx, overlay, sceneLeft, sceneTop);
        break;
      case "text":
        drawTextOverlay(ctx, overlay, sceneLeft, sceneTop);
        break;
      case "draw":
        // Painted pixels only exist in their layer canvas , unlike blur/pixelate
        // there are no parameters to recompute them from, so blit instead of filtering.
        drawOverlayOnto(ctx, overlay, sceneLeft, sceneTop, effectLayers);
        break;
      default:
        applyEffectRegion(ctx, sceneLeft, sceneTop, overlay);
    }
  }

  return {
    image: ctx.getImageData(left - sceneLeft, top - sceneTop, right - left, bottom - top),
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
