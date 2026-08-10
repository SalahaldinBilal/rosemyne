import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import styles from "./CropSelectionBox.module.scss";
import { useAnnotationState } from "../../states/annotationContext";
import ResizableBox from "../ResizableBox/ResizableBox";
import { Tools } from "../../types";

const MIN_CROP_SIZE = 5;

// The box defaults to the whole image (so saving without cropping keeps it all)
// but stays invisible until the Crop tool actually drags one out. Resets on
// every new image since a restitch can change its height.
function CropSelectionBox() {
  const {
    selectedBox, setSelectedBox, image, toImageCoords, setIsOverlayInteracting,
    mouseEventHandler, currentTool,
  } = useAnnotationState();

  const [cropped, setCropped] = createSignal(false);
  let dragStart: { x: number, y: number } | null = null;

  function selectWholeImage() {
    const base = image();
    if (!base) return;
    setSelectedBox({ x: 0, y: 0, width: base.naturalWidth, height: base.naturalHeight });
    setCropped(false);
  }

  createEffect(selectWholeImage);

  // Lets the Crop tool drag out a fresh selection, same gesture as creating a box overlay.
  function mouseDownHandler(event: MouseEvent) {
    if (currentTool() !== Tools.Screenshot || event.button !== 0) return;

    dragStart = toImageCoords(event.clientX, event.clientY);
    setSelectedBox({ x: dragStart.x, y: dragStart.y, width: 0, height: 0 });
    setCropped(true);
    setIsOverlayInteracting(true);
    window.addEventListener("mousemove", mouseMoveHandler);
    window.addEventListener("mouseup", stopDrag);
  }

  function mouseMoveHandler(event: MouseEvent) {
    if (!dragStart) return;
    const point = toImageCoords(event.clientX, event.clientY);
    setSelectedBox({
      x: Math.min(point.x, dragStart.x),
      y: Math.min(point.y, dragStart.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    });
  }

  function stopDrag() {
    window.removeEventListener("mousemove", mouseMoveHandler);
    window.removeEventListener("mouseup", stopDrag);
    if (dragStart) {
      setIsOverlayInteracting(false);
      // A bare click with the Crop tool isn't a crop, keep the whole image.
      if (selectedBox.width < MIN_CROP_SIZE || selectedBox.height < MIN_CROP_SIZE) selectWholeImage();
    }
    dragStart = null;
  }

  onMount(() => mouseEventHandler.on("mouseDown", mouseDownHandler));
  onCleanup(() => {
    stopDrag();
    mouseEventHandler.off("mouseDown", mouseDownHandler);
  });

  return (
    <ResizableBox
      borderWidth={3}
      pointRadius={18}
      show={cropped()}
      toContainerCoords={toImageCoords}
      onResize={dims => setSelectedBox(dims)}
      onResizeStart={() => setIsOverlayInteracting(true)}
      onResizeEnd={() => setIsOverlayInteracting(false)}
    >
      {ref => (
        <Show when={cropped()}>
          <div
            ref={ref}
            class={styles.CropBox}
            style={{
              left: `${selectedBox.x}px`, top: `${selectedBox.y}px`,
              width: `${selectedBox.width}px`, height: `${selectedBox.height}px`,
            }}
          />
        </Show>
      )}
    </ResizableBox>
  );
}

export default CropSelectionBox;
