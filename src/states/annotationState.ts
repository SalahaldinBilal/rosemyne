import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { createAsync } from "@solidjs/router";
import mitt from "mitt";
import { Dimensions, Position, Tools } from "../types";
import { ImageOverlay } from "../types/imageOverlay";
import { loadImage } from "../helpers";

// Point-based (not MouseEvent-based) so it also converts getBoundingClientRect() reads, not just live pointer events.
export type ToImageCoords = (clientX: number, clientY: number) => Position;

// Converts a raw screen-pixel delta (e.g. a drag library's own pointer-movement
// tracking) into image space, distinct from ToImageCoords since a delta has no
// fixed origin to subtract, only the ambient scale to divide out.
export type ToImageDelta = (dx: number, dy: number) => Position;

// Valid when the host's content is unscrolled and unzoomed; scrolling/zooming hosts supply their own.
const identityToImageCoords: ToImageCoords = (clientX, clientY) => ({ x: clientX, y: clientY });
const identityToImageDelta: ToImageDelta = (dx, dy) => ({ x: dx, y: dy });

// Shared annotation state/logic, screenshotOverlayState.ts and the scrolling capture result window each wrap this.
export function createAnnotationState(
  previewUrl: () => string | null,
  toImageCoords: ToImageCoords = identityToImageCoords,
  toImageDelta: ToImageDelta = identityToImageDelta,
) {
  const [selectedBox, setSelectedBox] = createStore<Dimensions>({ x: 0, y: 0, width: 0, height: 0 });
  // True only while a region drag is actually held down, not while a window
  // is merely hover-highlighted, see `cancelCurrentAction` in the host state.
  const [isSelectingRegion, setIsSelectingRegion] = createSignal(false);
  const [currentTool, setCurrentTool] = createSignal<Tools>(Tools.Screenshot);
  // Draw/Erase have no per-item box to hang attributes off of (see DrawLayer.tsx),
  // so their brush settings are global tool state instead.
  const [drawColor, setDrawColor] = createSignal<`#${string}`>("#ff0000");
  const [brushSize, setBrushSize] = createSignal(5);
  const [eraserSize, setEraserSize] = createSignal(24);
  // True while an overlay item is actively being moved or resized, so chrome like the toolbox can get out of the way.
  const [isOverlayInteracting, setIsOverlayInteracting] = createSignal(false);
  const [overlayItems, setOverlayItems] = createStore<Array<ImageOverlay>>([]);
  const image = createAsync<HTMLImageElement | undefined>(() => previewUrl() ? loadImage(previewUrl()!) : new Promise(res => res(undefined)));
  // `cancelDrag` tells the active selection UI to drop its own in-progress
  // drag tracking, it has no payload of its own.
  const mouseEventHandler = mitt<{ mouseDown: MouseEvent, cancelDrag: void }>();

  // Rendered preview canvases of blur/pixelate overlays, keyed by overlay
  // order, so effects above can composite the ones below. The map itself is
  // non-reactive; version bumps are the change signal.
  const effectLayers = new Map<number, HTMLCanvasElement>();
  const [layerVersions, setLayerVersions] = createStore<Record<number, number>>({});

  function bumpLayerVersion(order: number) {
    setLayerVersions(order, version => (version ?? 0) + 1);
  }

  function removeEffectLayer(order: number) {
    effectLayers.delete(order);
  }

  // A just-cancelled drag/selection still has a pending mouseup, which fires
  // a trailing click, don't let it confirm-select. Armed only when a
  // button was actually down.
  let pendingClickSuppressed = false;

  function suppressNextClick() {
    pendingClickSuppressed = true;
  }

  function consumeSuppressedClick(): boolean {
    if (!pendingClickSuppressed) return false;
    pendingClickSuppressed = false;
    return true;
  }

  /**
   * @returns index of added overlay
   */
  function addOverlayItem<T extends Omit<ImageOverlay, "order">>(item: T): number {
    const index = overlayItems.length;
    // Deletions leave gaps, so the next order must top the maximum, not the length.
    const order = overlayItems.reduce((max, existing) => Math.max(max, existing.order + 1), 0);
    setOverlayItems(index, { ...item, order } as ImageOverlay);
    return index;
  }

  // There's only ever one draw layer, so "clear" just removes it outright ,
  // the next stroke lazily creates a fresh one (see DrawLayer.tsx).
  function clearDrawing() {
    const drawItem = overlayItems.find(item => item.type === "draw");
    if (!drawItem) return;

    const canvas = effectLayers.get(drawItem.order);
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);

    removeEffectLayer(drawItem.order);
    setOverlayItems(overlayItems.filter(item => item.type !== "draw"));
  }

  function resetEditing() {
    setSelectedBox({ x: 0, y: 0, width: 0, height: 0 });
    setOverlayItems([]);
    effectLayers.clear();
    // The next capture should always start in selection mode, not
    // whatever annotation tool happened to be active last time.
    setCurrentTool(Tools.Screenshot);
  }

  return {
    selectedBox, setSelectedBox, isSelectingRegion, setIsSelectingRegion,
    currentTool, setCurrentTool, drawColor, setDrawColor, brushSize, setBrushSize, eraserSize, setEraserSize,
    isOverlayInteracting, setIsOverlayInteracting, overlayItems, setOverlayItems, addOverlayItem, clearDrawing,
    image, mouseEventHandler, effectLayers, layerVersions, bumpLayerVersion, removeEffectLayer,
    suppressNextClick, consumeSuppressedClick, toImageCoords, toImageDelta, resetEditing,
  };
}

export type AnnotationState = ReturnType<typeof createAnnotationState>;
