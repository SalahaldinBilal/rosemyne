import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import styles from "./SelectionBox.module.scss";
import useScreenshotOverlayStateInner from "../../../states/screenshotOverlayState";
import WindowSelectionBox from "./WindowSelectionBox/WindowSelectionBox";
import { Tools } from "../../../types";
import { createStore } from "solid-js/store";

function SelectionBox() {
  const { imageData, selectedBox, previewUrl, currentTool, setSelectedBox, closeOverlay, mouseEventHandler, suppressNextClick, setIsSelectingRegion } = useScreenshotOverlayStateInner;
  const [isMouseDown, setIsMouseDown] = createSignal<boolean>(false);
  const [hasMovedOnce, setHasMovedOnce] = createSignal<boolean>(false);
  const [mouseDownLocation, setMouseDownLocation] = createStore<{ x: number, y: number }>({ x: 0, y: 0 });

  onMount(() => {
    mouseEventHandler.on("mouseDown", mouseDownHandler)
    mouseEventHandler.on("cancelDrag", handleCancelDrag)
  })

  onCleanup(() => {
    cleanup();
    mouseEventHandler.off("mouseDown", mouseDownHandler)
    mouseEventHandler.off("cancelDrag", handleCancelDrag)
  })

  // The shared store already resets `selectedBox`; this stops this
  // component's own drag tracking so a stray mousemove can't redraw it. A
  // button still physically down means its release will fire a trailing
  // click on whatever's under the cursor , suppress that too, or it can
  // land on a WindowSelectionBox and confirm-select right after cancelling.
  function handleCancelDrag() {
    if (isMouseDown()) suppressNextClick();
    cleanup();
  }
  createEffect(() => {
    if (currentTool() === Tools.Screenshot) return;
    cleanup();
  })

  createEffect(() => {
    if (!imageData() || currentTool() !== Tools.Screenshot) return;

    document.body.style.cursor = "crosshair";
    onCleanup(() => { document.body.style.cursor = ""; });
  })

  function mouseDownHandler(event: MouseEvent) {
    if (currentTool() !== Tools.Screenshot || event.button !== 0) return;

    event.preventDefault();

    setIsMouseDown(true);
    setIsSelectingRegion(true);
    setMouseDownLocation({ x: event.clientX, y: event.clientY });

    window.addEventListener("mousemove", mouseMoveHandler);
    window.addEventListener("mouseup", mouseUpHandler)
  }

  function mouseMoveHandler(event: MouseEvent) {
    if (!isMouseDown()) return;

    if (!hasMovedOnce()) setHasMovedOnce(true);

    setSelectedBox({
      x: event.clientX < mouseDownLocation.x ? event.clientX : mouseDownLocation.x,
      y: event.clientY < mouseDownLocation.y ? event.clientY : mouseDownLocation.y,
      width: Math.abs(event.clientX - mouseDownLocation.x),
      height: Math.abs(event.clientY - mouseDownLocation.y)
    });
  }

  function mouseUpHandler(event: MouseEvent) {
    // `cleanup()` must run on every path , it's what un-registers this very
    // listener and resets `hasMovedOnce`/`isMouseDown`. SelectionBox never
    // unmounts between capture sessions, so skipping it on the "no movement"
    // or "successful save" paths (as this used to) left both stuck from a
    // prior session; a plain click, or the drag saving, both call it now.
    const moved = hasMovedOnce();
    cleanup();

    if (!moved) return;

    if (selectedBox.width > 5 && selectedBox.height > 5 && event.button === 0) {
      closeOverlay(imageData()!.imageId);
    }
  }

  function cleanup() {
    setHasMovedOnce(false);
    setIsMouseDown(false);
    setIsSelectingRegion(false);
    setMouseDownLocation({ x: 0, y: 0 });
    window.removeEventListener("mousemove", mouseMoveHandler);
    window.removeEventListener("mouseup", mouseUpHandler)
  }

  return (
    <Show when={imageData() && currentTool() === Tools.Screenshot}>
      <Show when={selectedBox.width > 5 && selectedBox.height > 5}>
        <>
          <div
            class={styles.WindowSelectionBox}
            classList={{ [styles.MouseDown]: isMouseDown() }}
            style={{
              left: (selectedBox.x - 2).toString() + "px", top: (selectedBox.y - 2).toString() + "px",
              width: (selectedBox.width + 4).toString() + "px", height: (selectedBox.height + 4).toString() + "px",
            }}
          />
          <div
            class={styles.DimensionsLabel}
            style={{
              left: (selectedBox.x - 2).toString() + "px",
              top: (selectedBox.y > 24 ? selectedBox.y - 24 : selectedBox.y + selectedBox.height + 6).toString() + "px",
            }}
          >
            {Math.round(selectedBox.width)} × {Math.round(selectedBox.height)}
          </div>
          <Show when={isMouseDown() && !imageData()?.pickRegion && !imageData()?.record}>
            <div
              class={styles.LightPreviewContainer}
              style={{
                left: (selectedBox.x - 2).toString() + "px", top: (selectedBox.y - 2).toString() + "px",
                width: (selectedBox.width + 4).toString() + "px", height: (selectedBox.height + 4).toString() + "px",
              }}
            >
              <img
                src={previewUrl() ?? ""}
                style={{ left: (-selectedBox.x + 2).toString() + "px", top: (-selectedBox.y + 2).toString() + "px" }}
              />
            </div>
          </Show>
        </>
      </Show>
      <For each={imageData()!.windows}>
        {window =>
          <Show when={window.visiblePercentage > 0}>
            <WindowSelectionBox window={window} onMouseDown={mouseDownHandler} hasMovedOnce={hasMovedOnce()}></WindowSelectionBox>
            <For each={window.subDimensions}>
              {subWindow => <WindowSelectionBox window={window} overloadPosition={subWindow} onMouseDown={mouseDownHandler} hasMovedOnce={hasMovedOnce()}></WindowSelectionBox>}
            </For>
          </Show>
        }
      </For>
    </Show>
  );
}

export default SelectionBox;
