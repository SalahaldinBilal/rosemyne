import { createMemo, createRoot, createSignal } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { Data, Dimensions, WindowInfo } from "../types/screenshot";
import { ImageOverlay } from "../types/imageOverlay";
import { loadImage } from "../helpers";
import { renderFinalImage } from "../helpers/canvasRenderer";
import { saveScreenshot } from "../helpers/saveScreenshot";
import { createAsync } from "@solidjs/router";
import { Tools } from "../types";
import mitt from "mitt";
import { safeInvoke } from "@core/helpers/safeInvoke";
import useToastState from "./toastState";

function useScreenshotOverlayStateInner() {
  const { pushToast } = useToastState;
  const [imageData, setImageData] = createSignal<null | Data>(null);
  const [selectedBox, setSelectedBox] = createStore<Dimensions>({ x: 0, y: 0, width: 0, height: 0 });
  const [selectedWindow, setSelectedWindow] = createSignal<WindowInfo | null>(null);
  // True only while a region drag is actually held down (SelectionBox), not
  // while a window is merely hover-highlighted , see `cancelCurrentAction`.
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
  const previewUrl = createMemo(() => imageData() && !imageData()!.pickRegion && !imageData()!.record ? `http://rosemyne-photo.localhost/preview/${imageData()!.imageId}` : null);
  const image = createAsync<HTMLImageElement | undefined>(() => previewUrl() ? loadImage(previewUrl()!) : new Promise((res) => res(undefined)))
  // `cancelDrag` tells SelectionBox to drop its own in-progress drag
  // tracking (see `cancelCurrentAction`) , it has no payload of its own.
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

  async function closeOverlay(imageIdToSave?: number) {
    const box = { ...unwrap(selectedBox) };
    const currentImageId = imageData()?.imageId;
    const isPickMode = imageData()?.pickRegion === true;
    const isRecordMode = imageData()?.record === true;
    const baseImage = image();
    const overlays = unwrap(overlayItems);

    const resetEditing = () => {
      setImageData(null);
      setSelectedBox({ x: 0, y: 0, width: 0, height: 0 });
      setSelectedWindow(null);
      setOverlayItems([]);
      effectLayers.clear();
      // The next capture should always start in selection mode, not
      // whatever annotation tool happened to be active last time.
      setCurrentTool(Tools.Screenshot);
    };

    // Region-pick mode: report the drawn rectangle (or a cancel) instead of
    // rendering and saving a screenshot.
    if (isPickMode) {
      safeInvoke("finish_region_pick", {
        region: imageIdToSave !== undefined
          ? { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
          : null,
      });
      resetEditing();
      return;
    }

    // Record mode: completing the selection starts the recording (the backend
    // hides the overlay and shows the HUD); anything else is a cancel.
    if (isRecordMode) {
      if (imageIdToSave !== undefined && box.width > 5 && box.height > 5) {
        safeInvoke("start_recording", {
          region: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
        }).catch(error => pushToast(`Failed to start recording: ${typeof error === "string" ? error : JSON.stringify(error)}`, "error", 6000));
      } else {
        safeInvoke("hide_screenshot_window");
      }
      resetEditing();
      return;
    }

    if (imageIdToSave !== undefined && baseImage) {
      // Hide instantly (keeps the temp image Rust-side for window tagging),
      // then render the final pixels from the same code paths as the preview.
      safeInvoke('hide_screenshot_window');

      const final = renderFinalImage(baseImage, box, overlays, effectLayers);
      resetEditing();

      if (final) {
        saveScreenshot(imageIdToSave, { x: final.x, y: final.y, width: final.width, height: final.height }, final.image);
      } else {
        safeInvoke('hide_screenshot_window', { id: imageIdToSave });
      }
    } else {
      resetEditing();
      safeInvoke('hide_screenshot_window', currentImageId !== undefined ? { id: currentImageId } : undefined);
    }
  }

  // Right-click and Escape both go through this. An actual region drag in
  // progress, or a tool actively creating/moving an overlay item, gets
  // cleared on its own so the user can try again; a window merely being
  // hover-highlighted isn't an action to cancel , it's passive, and clearing
  // it would just get immediately replaced by the next mouse move anyway.
  // The whole overlay only closes when there's nothing actually in progress.
  function cancelCurrentAction() {
    if (isSelectingRegion() || isOverlayInteracting()) {
      mouseEventHandler.emit("cancelDrag");
      setSelectedBox({ x: 0, y: 0, width: 0, height: 0 });
      setSelectedWindow(null);
      return;
    }

    closeOverlay();
  }

  // Cancelling mid-drag (see `cancelCurrentAction`) doesn't un-press the
  // mouse button , the browser still fires a `click` on whatever's under the
  // cursor once it's released. Without this, that trailing click would land
  // on a WindowSelectionBox and confirm-select it right after the user just
  // cancelled. SelectionBox arms this only when a button was actually down.
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
  // the next stroke lazily creates a fresh one (see DrawLayer.tsx). The
  // registered canvas is DrawLayer's own persistent element, not something
  // recreated from the store, so its pixels must be wiped explicitly , just
  // dropping the bookkeeping would leave the old strokes visibly on screen
  // (and stuck there, since the eraser treats "no draw item" as "nothing to erase").
  function clearDrawing() {
    const drawItem = overlayItems.find(item => item.type === "draw");
    if (!drawItem) return;

    const canvas = effectLayers.get(drawItem.order);
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);

    removeEffectLayer(drawItem.order);
    setOverlayItems(overlayItems.filter(item => item.type !== "draw"));
  }

  return {
    imageData, selectedBox, selectedWindow, closeOverlay, cancelCurrentAction,
    suppressNextClick, consumeSuppressedClick,
    setImageData, setSelectedBox, setSelectedWindow,
    addOverlayItem, clearDrawing, overlayItems, setOverlayItems, previewUrl, image, currentTool, setCurrentTool, mouseEventHandler,
    isOverlayInteracting, setIsOverlayInteracting, isSelectingRegion, setIsSelectingRegion,
    effectLayers, layerVersions, bumpLayerVersion, removeEffectLayer,
    drawColor, setDrawColor, brushSize, setBrushSize, eraserSize, setEraserSize,
  };
}

const useScreenshotOverlayState = createRoot(useScreenshotOverlayStateInner)
export default useScreenshotOverlayState;
