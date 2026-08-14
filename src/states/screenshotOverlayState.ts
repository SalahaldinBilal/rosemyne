import { createEffect, createMemo, createRoot, createSignal, untrack } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { listen } from "@tauri-apps/api/event";
import { CursorImageInfo, Data, WindowInfo } from "../types/screenshot";
import { Dimensions, Position, ScrollCaptureOverrides } from "../types";
import { CURSOR_IMAGE_NAME } from "../constants";
import { renderFinalImage } from "../helpers/canvasRenderer";
import { saveScreenshot } from "../helpers/saveScreenshot";
import { safeInvoke } from "@core/helpers/safeInvoke";
import useToastState from "./toastState";
import useOverlayDefaultsState from "./overlayDefaultsState";
import useOverlayImagesState from "./overlayImagesState";
import { createAnnotationState } from "./annotationState";

function useScreenshotOverlayStateInner() {
  const { pushToast } = useToastState;
  const [imageData, setImageData] = createSignal<null | Data>(null);
  const [selectedWindow, setSelectedWindow] = createSignal<WindowInfo | null>(null);
  // Per-instance scroll-capture tuning, re-seeded from settings every time that mode starts; never written back.
  const [scrollCaptureParams, setScrollCaptureParams] = createStore<ScrollCaptureOverrides>({
    maxFrames: 9,
    frameDelayMs: 400,
    scrollDistance: { type: "percent", data: 80 },
  });

  // A drag smaller than this on either axis counts as a click on the window
  // under the cursor. Re-read on every capture, since this window is never
  // recreated and would otherwise keep whatever was set when it first loaded.
  const [minSelectionSize, setMinSelectionSize] = createStore({ width: 15, height: 15 });

  createEffect(() => {
    if (!imageData()) return;

    safeInvoke("get_general_settings")
      .then(settings => setMinSelectionSize({ width: settings.minSelectionWidth, height: settings.minSelectionHeight }))
      .catch(() => {
        // Best-effort; the selector just keeps whatever it already had.
      });
  });

  createEffect(() => {
    if (imageData()?.scrollCapture !== true) return;

    safeInvoke("get_scrolling_capture_settings")
      .then(settings => setScrollCaptureParams({
        maxFrames: settings.maxFrames,
        frameDelayMs: settings.frameDelayMs,
        scrollDistance: settings.scrollDistance,
      }))
      .catch(() => {
        // Best-effort; the panel just keeps whatever it already had.
      });
  });
  const previewUrl = createMemo(() => {
    const data = imageData();
    return data && !data.pickRegion && !data.record && !data.scrollCapture
      ? `http://rosemyne-photo.localhost/preview/${data.imageId}`
      : null;
  });

  const annotation = createAnnotationState(previewUrl);
  const {
    selectedBox, overlayItems, setOverlayItems, addOverlayItem, image, mouseEventHandler, effectLayers,
    isSelectingRegion, isOverlayInteracting, resetEditing, setSelectedImage,
  } = annotation;

  // Lets a later-arriving cursor re-place itself, but only while the user hasn't touched it.
  let autoPlacedCursor: { index: number, dimensions: Dimensions, mouse: Position } | null = null;

  function cursorDimensions(cursor: CursorImageInfo, mouse: Position): Dimensions {
    return {
      x: mouse.x - cursor.hotspotX,
      y: mouse.y - cursor.hotspotY,
      width: cursor.width,
      height: cursor.height,
    };
  }

  // Untracked: placing reads the overlay list, which would re-run this on every later edit.
  createEffect(() => {
    const data = imageData();
    if (!data || data.pickRegion || data.record || data.scrollCapture) return;

    untrack(() => {
      setSelectedImage(useOverlayDefaultsState.merged.image.image.value);
      if (!data.autoPlaceCursor || !data.cursor) return;

      const dimensions = cursorDimensions(data.cursor, data.mousePosition);
      const index = addOverlayItem({
        type: "image",
        attributes: {
          image: { type: "select", value: CURSOR_IMAGE_NAME, options: useOverlayImagesState.names() },
          opacity: { type: "number", value: 100, min: 0, max: 100 },
        },
        dimensions,
      });

      autoPlacedCursor = { index, dimensions, mouse: data.mousePosition };
    });
  });

  listen<CursorImageInfo>("cursor://updated", event => {
    if (!autoPlacedCursor) return;

    const placed = overlayItems[autoPlacedCursor.index];
    const previous = autoPlacedCursor.dimensions;
    if (!placed || placed.type !== "image") return;
    if (placed.dimensions.x !== previous.x || placed.dimensions.y !== previous.y
      || placed.dimensions.width !== previous.width || placed.dimensions.height !== previous.height) return;

    const dimensions = cursorDimensions(event.payload, autoPlacedCursor.mouse);
    setOverlayItems(autoPlacedCursor.index, "dimensions", dimensions);
    autoPlacedCursor.dimensions = dimensions;
  });

  async function closeOverlay(imageIdToSave?: number) {
    const box = { ...unwrap(selectedBox) };
    const currentImageId = imageData()?.imageId;
    const isPickMode = imageData()?.pickRegion === true;
    const isRecordMode = imageData()?.record === true;
    const isScrollCaptureMode = imageData()?.scrollCapture === true;
    const baseImage = image();
    const overlays = unwrap(overlayItems);

    const finishEditingSession = () => {
      setImageData(null);
      setSelectedWindow(null);
      autoPlacedCursor = null;
      resetEditing();
    };

    // Region-pick mode: report the drawn rectangle (or a cancel) instead of
    // rendering and saving a screenshot.
    if (isPickMode) {
      safeInvoke("finish_region_pick", {
        region: imageIdToSave !== undefined
          ? { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
          : null,
      });
      finishEditingSession();
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
      finishEditingSession();
      return;
    }

    // Scroll-capture mode: completing the selection scrolls + captures the
    // region (the backend hides the overlay, shows the HUD, then the result
    // window once stitching finishes); anything else is a cancel.
    if (isScrollCaptureMode) {
      if (imageIdToSave !== undefined && box.width > 5 && box.height > 5) {
        safeInvoke("start_scrolling_capture", {
          region: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
          id: imageIdToSave,
          overrides: { ...unwrap(scrollCaptureParams) },
        }).catch(error => pushToast(`Failed to start scrolling capture: ${typeof error === "string" ? error : JSON.stringify(error)}`, "error", 6000));
      } else {
        safeInvoke("hide_screenshot_window");
      }
      finishEditingSession();
      return;
    }

    if (imageIdToSave !== undefined && baseImage) {
      // Hide instantly (keeps the temp image Rust-side for window tagging),
      // then render the final pixels from the same code paths as the preview.
      safeInvoke('hide_screenshot_window');

      const final = renderFinalImage(baseImage, box, overlays, effectLayers);
      finishEditingSession();

      if (final) {
        saveScreenshot(imageIdToSave, { x: final.x, y: final.y, width: final.width, height: final.height }, final.image);
      } else {
        safeInvoke('hide_screenshot_window', { id: imageIdToSave });
      }
    } else {
      finishEditingSession();
      safeInvoke('hide_screenshot_window', currentImageId !== undefined ? { id: currentImageId } : undefined);
    }
  }

  // Single source of truth for "something cancelable is in progress", shared
  // by cancelCurrentAction (Escape) and Screenshot.tsx's contextmenu capture
  // gate (right-click): those two gestures must never diverge on this check.
  const hasActiveInteraction = () => isSelectingRegion() || isOverlayInteracting();

  // Right-click and Escape both go through this; the active selection UI's
  // own `cancelDrag` handler owns re-selecting the hovered window. Only closes
  // the overlay when nothing's in progress.
  function cancelCurrentAction() {
    if (hasActiveInteraction()) {
      mouseEventHandler.emit("cancelDrag");
      return;
    }

    closeOverlay();
  }

  return {
    ...annotation,
    imageData, setImageData, selectedWindow, setSelectedWindow,
    closeOverlay, cancelCurrentAction, hasActiveInteraction, previewUrl, minSelectionSize,
    scrollCaptureParams, setScrollCaptureParams,
  };
}

const useScreenshotOverlayState = createRoot(useScreenshotOverlayStateInner)
export default useScreenshotOverlayState;
