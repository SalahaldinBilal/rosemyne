import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { unwrap } from "solid-js/store";
import styles from "./CropSelectionBox.module.scss";
import { useAnnotationState } from "../../states/annotationContext";
import ResizableBox from "../ResizableBox/ResizableBox";
import { getIntersection } from "../../helpers";
import { Tools } from "../../types";

const MIN_CROP_SIZE = 5;
// Screen pixels, divided by the view scale so the outline stays visible at any zoom.
const CROP_OUTLINE_WIDTH = 2;

// The box defaults to the whole image (so saving without cropping keeps it all)
// but stays invisible until the Crop tool actually drags one out. Resets on
// every new image since a restitch can change its height.
function CropSelectionBox() {
  const {
    selectedBox, setSelectedBox, image, toImageCoords, setIsOverlayInteracting,
    mouseEventHandler, currentTool, viewScale,
  } = useAnnotationState();

  const [cropped, setCropped] = createSignal(false);
  const outlineWidth = createMemo(() => `${CROP_OUTLINE_WIDTH / viewScale()}px`);
  let dragStart: { x: number, y: number } | null = null;

  function selectWholeImage() {
    const base = image();
    if (!base) return;
    setSelectedBox({ x: 0, y: 0, width: base.naturalWidth, height: base.naturalHeight });
    setCropped(false);
  }

  createEffect(selectWholeImage);

  // Dragging past the image (or starting outside it) is how edge-hugging
  // regions get picked at all, so the box is only pulled back inside once the
  // gesture ends; a crop that ends up too small to be one keeps the whole image.
  function settleInsideImage() {
    const base = image();
    if (!base) return;

    const inside = getIntersection(unwrap(selectedBox), { x: 0, y: 0, width: base.naturalWidth, height: base.naturalHeight });
    if (!inside || inside.width < MIN_CROP_SIZE || inside.height < MIN_CROP_SIZE) {
      selectWholeImage();
      return;
    }

    setSelectedBox(inside);
  }

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
      settleInsideImage();
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
      borderWidth={0}
      style={{ "box-shadow": "none" }}
      pointRadius={18}
      scale={viewScale()}
      show={cropped()}
      toContainerCoords={toImageCoords}
      onResize={dims => setSelectedBox(dims)}
      onResizeStart={() => setIsOverlayInteracting(true)}
      onResizeEnd={() => { setIsOverlayInteracting(false); settleInsideImage(); }}
    >
      {ref => (
        <Show when={cropped()}>
          <div
            ref={ref}
            class={styles.CropBox}
            style={{
              left: `${selectedBox.x}px`, top: `${selectedBox.y}px`,
              width: `${selectedBox.width}px`, height: `${selectedBox.height}px`,
              "border-width": outlineWidth(),
            }}
          />
        </Show>
      )}
    </ResizableBox>
  );
}

export default CropSelectionBox;
