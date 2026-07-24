import { createEffect, onCleanup, onMount } from "solid-js";
import styles from "./CropSelectionBox.module.scss";
import { useAnnotationState } from "../../states/annotationContext";
import ResizableBox from "../ResizableBox/ResizableBox";
import { Tools } from "../../types";

// Defaults to the whole image, resetting on every new image since a restitch can change its height.
function CropSelectionBox() {
  const {
    selectedBox, setSelectedBox, image, toImageCoords, setIsOverlayInteracting,
    mouseEventHandler, currentTool,
  } = useAnnotationState();

  let dragStart: { x: number, y: number } | null = null;

  createEffect(() => {
    const base = image();
    if (!base) return;
    setSelectedBox({ x: 0, y: 0, width: base.naturalWidth, height: base.naturalHeight });
  });

  // Lets the Crop tool drag out a fresh selection, same gesture as creating a box overlay.
  function mouseDownHandler(event: MouseEvent) {
    if (currentTool() !== Tools.Screenshot || event.button !== 0) return;

    dragStart = toImageCoords(event.clientX, event.clientY);
    setSelectedBox({ x: dragStart.x, y: dragStart.y, width: 0, height: 0 });
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
    if (dragStart) setIsOverlayInteracting(false);
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
      show
      toContainerCoords={toImageCoords}
      onResize={dims => setSelectedBox(dims)}
      onResizeStart={() => setIsOverlayInteracting(true)}
      onResizeEnd={() => setIsOverlayInteracting(false)}
    >
      {ref => (
        <div
          ref={ref}
          class={styles.CropBox}
          style={{
            left: `${selectedBox.x}px`, top: `${selectedBox.y}px`,
            width: `${selectedBox.width}px`, height: `${selectedBox.height}px`,
          }}
        />
      )}
    </ResizableBox>
  );
}

export default CropSelectionBox;
