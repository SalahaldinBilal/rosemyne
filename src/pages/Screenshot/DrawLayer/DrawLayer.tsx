import { createMemo, onCleanup, onMount } from "solid-js";
import useScreenshotOverlayStateInner from "../../../states/screenshotOverlayState";
import { Tools } from "../../../types";
import { DrawImageOverlay } from "../../../types/imageOverlay";

const MIN_STROKE_WIDTH = 1;

/**
 * Freehand draw/erase , unlike every other overlay tool this paints directly
 * onto one persistent full-capture canvas instead of placing a resizable box,
 * so the user can draw or erase anywhere without first carving out a region.
 * Reuses the same `effectLayers` registry blur/pixelate use to publish their
 * rendered canvas, since a draw layer is exactly that: a canvas other layers
 * (and the final save) can composite , it just gets painted into imperatively
 * instead of being recomputed from parameters.
 */
function DrawLayer() {
  const {
    image, overlayItems, addOverlayItem, effectLayers, bumpLayerVersion,
    mouseEventHandler, currentTool, setIsOverlayInteracting,
    drawColor, brushSize, eraserSize,
  } = useScreenshotOverlayStateInner;

  let canvas: HTMLCanvasElement | undefined;
  let isDrawing = false;
  let isErasing = false;
  let lastPoint: { x: number, y: number } | null = null;
  // Captured once per stroke so painting never depends on the drawItem memo
  // having already re-run after the item was just created.
  let activeItem: DrawImageOverlay | null = null;

  const drawItem = createMemo(() => overlayItems.find((item): item is DrawImageOverlay => item.type === "draw"));
  const zIndex = createMemo(() => {
    const item = drawItem();
    return item ? 30001 + item.order : undefined;
  });

  onMount(() => {
    mouseEventHandler.on("mouseDown", mouseDownHandler);
    mouseEventHandler.on("cancelDrag", stopStroke);
  });

  onCleanup(() => {
    stopStroke();
    mouseEventHandler.off("mouseDown", mouseDownHandler);
    mouseEventHandler.off("cancelDrag", stopStroke);
  });

  function mouseDownHandler(event: MouseEvent) {
    const tool = currentTool();
    const isErase = tool === Tools.EraseOverlay;
    if (event.button !== 0 || (tool !== Tools.DrawOverlay && !isErase) || !image()) return;

    let item = drawItem();
    // Nothing drawn yet , nothing to erase.
    if (isErase && !item) return;

    if (!item) {
      const index = addOverlayItem<Omit<DrawImageOverlay, "order">>({
        type: "draw",
        attributes: {},
        dimensions: { x: 0, y: 0, width: image()!.naturalWidth, height: image()!.naturalHeight },
      });
      item = overlayItems[index] as DrawImageOverlay;
    }

    activeItem = item;
    isDrawing = true;
    isErasing = isErase;
    lastPoint = { x: event.clientX, y: event.clientY };
    setIsOverlayInteracting(true);
    paintSegment(lastPoint, lastPoint);

    window.addEventListener("mousemove", mouseMoveHandler);
    window.addEventListener("mouseup", stopStroke);
  }

  function mouseMoveHandler(event: MouseEvent) {
    if (!isDrawing) return;

    const point = { x: event.clientX, y: event.clientY };
    paintSegment(lastPoint!, point);
    lastPoint = point;
  }

  function stopStroke() {
    if (!isDrawing) return;

    isDrawing = false;
    lastPoint = null;
    activeItem = null;
    setIsOverlayInteracting(false);
    window.removeEventListener("mousemove", mouseMoveHandler);
    window.removeEventListener("mouseup", stopStroke);
  }

  function paintSegment(from: { x: number, y: number }, to: { x: number, y: number }) {
    const ctx = canvas?.getContext("2d");
    if (!activeItem || !ctx) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = isErasing ? "destination-out" : "source-over";
    ctx.strokeStyle = drawColor();
    ctx.lineWidth = Math.max(MIN_STROKE_WIDTH, isErasing ? eraserSize() : brushSize());
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();

    effectLayers.set(activeItem.order, canvas!);
    bumpLayerVersion(activeItem.order);
  }

  return <canvas
    ref={canvas}
    width={image()?.naturalWidth ?? 0}
    height={image()?.naturalHeight ?? 0}
    style={{
      position: "absolute", left: "0px", top: "0px",
      "pointer-events": "none",
      "z-index": zIndex(),
    }}
  />;
}

export default DrawLayer;
