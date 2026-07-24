import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { Data, WindowInfo } from "../types/screenshot";
import { ScrollCaptureOverrides } from "../types";
import { renderFinalImage } from "../helpers/canvasRenderer";
import { saveScreenshot } from "../helpers/saveScreenshot";
import { safeInvoke } from "@core/helpers/safeInvoke";
import useToastState from "./toastState";
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
    selectedBox, overlayItems, image, mouseEventHandler, effectLayers,
    isSelectingRegion, isOverlayInteracting, resetEditing,
  } = annotation;

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

  // Right-click and Escape both go through this; the active selection UI's
  // own `cancelDrag` handler owns re-selecting the hovered window. Only closes
  // the overlay when nothing's in progress.
  function cancelCurrentAction() {
    if (isSelectingRegion() || isOverlayInteracting()) {
      mouseEventHandler.emit("cancelDrag");
      return;
    }

    closeOverlay();
  }

  return {
    ...annotation,
    imageData, setImageData, selectedWindow, setSelectedWindow,
    closeOverlay, cancelCurrentAction, previewUrl,
    scrollCaptureParams, setScrollCaptureParams,
  };
}

const useScreenshotOverlayState = createRoot(useScreenshotOverlayStateInner)
export default useScreenshotOverlayState;
