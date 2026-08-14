import { createEffect, createMemo, onCleanup, onMount } from "solid-js";
import { useAnnotationState } from "../../../states/annotationContext";
import { Tools } from "../../../types";
import { DrawImageOverlay, DrawStroke } from "../../../types/imageOverlay";

const MIN_STROKE_WIDTH = 1;
type Point = { x: number, y: number };

// Paints directly onto one persistent canvas, published through the same effectLayers registry blur/pixelate use.
function DrawLayer() {
  const {
    image, overlayItems, setOverlayItems, addOverlayItem, effectLayers, bumpLayerVersion, removeEffectLayer,
    mouseEventHandler, currentTool, setIsOverlayInteracting,
    drawColor, brushSize, eraserSize, toImageCoords,
    strokes, strokesVersion, bumpStrokes, history,
  } = useAnnotationState();

  let canvas: HTMLCanvasElement | undefined;
  let isDrawing = false;
  let lastPoint: Point | null = null;
  let activeItem: DrawImageOverlay | null = null;
  let activeStroke: DrawStroke | null = null;
  let createdItemThisStroke = false;
  let renderedOrder: number | null = null;

  const drawItem = createMemo(() => overlayItems.find((item): item is DrawImageOverlay => item.type === "draw"));
  const zIndex = createMemo(() => {
    const item = drawItem();
    return item ? 30001 + item.order : undefined;
  });

  onMount(() => {
    mouseEventHandler.on("mouseDown", mouseDownHandler);
    mouseEventHandler.on("cancelDrag", cancelStroke);
  });

  onCleanup(() => {
    cancelStroke();
    mouseEventHandler.off("mouseDown", mouseDownHandler);
    mouseEventHandler.off("cancelDrag", cancelStroke);
  });

  // Sole source of truth for pixels outside a live stroke: undo/redo/clear/restitch all funnel through this repaint.
  createEffect(() => {
    strokesVersion();
    image();
    const item = drawItem();
    const ctx = canvas?.getContext("2d");
    if (!ctx || isDrawing) return;

    ctx.clearRect(0, 0, canvas!.width, canvas!.height);
    for (const stroke of strokes) replayStroke(ctx, stroke);

    if (renderedOrder !== null && renderedOrder !== (item?.order ?? null)) removeEffectLayer(renderedOrder);
    renderedOrder = item?.order ?? null;
    if (item) {
      effectLayers.set(item.order, canvas!);
      bumpLayerVersion(item.order);
    }
  });

  function mouseDownHandler(event: MouseEvent) {
    const tool = currentTool();
    const isErase = tool === Tools.EraseOverlay;
    if (event.button !== 0 || (tool !== Tools.DrawOverlay && !isErase) || !image()) return;

    let item = drawItem();
    // Nothing drawn yet, nothing to erase.
    if (isErase && !item) return;

    lastPoint = toImageCoords(event.clientX, event.clientY);
    activeStroke = {
      erase: isErase,
      color: drawColor(),
      size: Math.max(MIN_STROKE_WIDTH, isErase ? eraserSize() : brushSize()),
      points: [lastPoint],
    };
    strokes.push(activeStroke);
    createdItemThisStroke = !item;
    // Before addOverlayItem: its store write flushes the replay effect
    // synchronously, and isDrawing is what makes that run skip mid-stroke.
    isDrawing = true;
    setIsOverlayInteracting(true);

    if (!item) {
      const index = addOverlayItem<Omit<DrawImageOverlay, "order">>({
        type: "draw",
        attributes: {},
        dimensions: { x: 0, y: 0, width: image()!.naturalWidth, height: image()!.naturalHeight },
      });
      item = overlayItems[index] as DrawImageOverlay;
    }

    activeItem = item;
    livePaint(lastPoint, lastPoint);

    window.addEventListener("mousemove", mouseMoveHandler);
    window.addEventListener("mouseup", finishStroke);
  }

  function mouseMoveHandler(event: MouseEvent) {
    if (!isDrawing || !activeStroke) return;

    const point = toImageCoords(event.clientX, event.clientY);
    activeStroke.points.push(point);
    livePaint(lastPoint!, point);
    lastPoint = point;
  }

  function livePaint(from: Point, to: Point) {
    const ctx = canvas?.getContext("2d");
    if (!ctx || !activeItem || !activeStroke) return;

    paintSegment(ctx, activeStroke, from, to);
    effectLayers.set(activeItem.order, canvas!);
    bumpLayerVersion(activeItem.order);
  }

  function finishStroke(event: MouseEvent) {
    // A right-click's own mouseup fires before its contextmenu event; ignore it here too (see SelectionBox.tsx).
    if (event.button !== 0) return;
    if (!isDrawing) return;

    teardown();
    history.commit();
  }

  function cancelStroke() {
    if (!isDrawing) return;

    strokes.pop();
    if (createdItemThisStroke && activeItem) {
      const removed = activeItem;
      setOverlayItems(overlayItems.filter(item => item !== removed));
    }
    teardown();
    bumpStrokes();
  }

  function teardown() {
    isDrawing = false;
    lastPoint = null;
    activeItem = null;
    activeStroke = null;
    createdItemThisStroke = false;
    setIsOverlayInteracting(false);
    window.removeEventListener("mousemove", mouseMoveHandler);
    window.removeEventListener("mouseup", finishStroke);
  }

  function paintSegment(ctx: CanvasRenderingContext2D, stroke: DrawStroke, from: Point, to: Point) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  function replayStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke) {
    if (stroke.points.length === 0) return;
    if (stroke.points.length === 1) {
      paintSegment(ctx, stroke, stroke.points[0], stroke.points[0]);
      return;
    }
    for (let i = 1; i < stroke.points.length; i++) {
      paintSegment(ctx, stroke, stroke.points[i - 1], stroke.points[i]);
    }
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
