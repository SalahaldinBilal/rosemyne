import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js";
import { Event as TauriEvent } from "@tauri-apps/api/event";
import styles from "./Screenshot.module.scss";
import { Data } from "../../types/screenshot";
import useScreenshotOverlayStateInner from "../../states/screenshotOverlayState";
import AnnotationContext from "../../states/annotationContext";
import useOverlayDefaultsState from "../../states/overlayDefaultsState";
import useOverlayImagesState from "../../states/overlayImagesState";
import ImageOverlayContainer from "./ImageOverlayContainer/ImageOverlayContainer";
import DrawLayer from "./DrawLayer/DrawLayer";
import ToolBox from "./ToolBox/ToolBox";
import SelectionBox from "./SelectionBox/SelectionBox";
import ScrollCaptureLiveParams from "./ScrollCaptureLiveParams/ScrollCaptureLiveParams";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { makeEventListener } from "@solid-primitives/event-listener";
import { safeInvoke } from "@core/helpers/safeInvoke";
import { getDimensionFromPoints } from "@core/helpers";
import { Position } from "@core/types";

const arrowsKeysMovement: { [key: string]: Partial<Position> } = {
  "ArrowLeft": { x: -1 },
  "ArrowUp": { y: -1 },
  "ArrowRight": { x: 1 },
  "ArrowDown": { y: 1 }
};

// A tap only ever moves one pixel (the immediate move on keydown, below);
// holding starts repeating at this pace and accelerates toward the floor.
const MOVE_START_INTERVAL_MS = 160;
const MOVE_MIN_INTERVAL_MS = 12;
const MOVE_ACCELERATION = 0.85;

function Screenshot() {
  const { imageData, setImageData, cancelCurrentAction, hasActiveInteraction, mouseEventHandler, selectedBox, setClosing } = useScreenshotOverlayStateInner;
  const { refresh: refreshOverlayDefaults } = useOverlayDefaultsState;
  const { refresh: refreshOverlayImages } = useOverlayImagesState;
  const mouseMovement = { x: 0, y: 0 };
  let movementTimer: ReturnType<typeof setTimeout> | undefined;
  let movementInterval = MOVE_START_INTERVAL_MS;
  const hasSelection = createMemo(() => selectedBox.width > 5 && selectedBox.height > 5);

  createEffect(() => {
    if (!imageData()) {
      editMouseMovementDirection({ x: 0, y: 0 }, "set");
      stopMovementLoop();
      return;
    }

    getCurrentWebviewWindow().setFocus();
    window.focus();
    window.document.body.click();
  })

  onCleanup(stopMovementLoop);

  // Native keydown auto-repeat only reliably repeats one key at a time (so
  // holding e.g. Right then also holding Down would stall or drop the
  // diagonal) and fires at a fixed OS rate from the start, this instead
  // drives continuous movement from its own timer, starting at
  // `MOVE_START_INTERVAL_MS` and accelerating the longer a direction stays held.
  function scheduleNextMove() {
    movementTimer = setTimeout(() => {
      if (!imageData() || (mouseMovement.x === 0 && mouseMovement.y === 0)) {
        movementTimer = undefined;
        movementInterval = MOVE_START_INTERVAL_MS;
        return;
      }

      safeInvoke("move_mouse_by", mouseMovement);
      movementInterval = Math.max(MOVE_MIN_INTERVAL_MS, movementInterval * MOVE_ACCELERATION);
      scheduleNextMove();
    }, movementInterval);
  }

  function stopMovementLoop() {
    clearTimeout(movementTimer);
    movementTimer = undefined;
    movementInterval = MOVE_START_INTERVAL_MS;
  }

  onMount(async () => {
    // Region-pick mode shows the real desktop through the transparent window
    // (with a CSS dim layer), so the document canvas must not paint opaque.
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    getCurrentWebviewWindow().listen("screenshot://data", (event: TauriEvent<Data>) => {
      setClosing(false);
      setImageData(event.payload);
      refreshOverlayDefaults();
      refreshOverlayImages();
    });
  })

  // preventDefault always (a resize handle has no onContextMenu of its own to do it);
  // capture phase + stopPropagation below only when canceling, to still win over a placed item's own menu.
  makeEventListener(window, "contextmenu", event => {
    if (!imageData()) return;
    event.preventDefault();
    if (!hasActiveInteraction()) return;
    event.stopPropagation();
    cancelCurrentAction();
  }, { capture: true });

  // Bubble phase: only reachable when nothing claimed the right-click, the
  // cancel path above and a placed item's own menu both stopPropagation, so
  // this is an idle right-click on empty space, which closes the overlay.
  makeEventListener(window, "contextmenu", () => {
    if (!imageData()) return;
    cancelCurrentAction();
  });

  makeEventListener(window, "keydown", event => {
    if (!imageData()) return;

    if (event.code === "Escape") {
      cancelCurrentAction();
      return;
    }

    const keyMovement = arrowsKeysMovement[event.code];
    if (!keyMovement || event.repeat) return;

    editMouseMovementDirection(keyMovement, "add");
    // Every discrete press moves one pixel immediately, whether or not it
    // turns into a hold; the accelerating repeat (if any) is separate.
    safeInvoke("move_mouse_by", mouseMovement);
    if (movementTimer === undefined) scheduleNextMove();
  }, { capture: true });

  makeEventListener(window, "keyup", event => {
    if (!imageData()) return;

    const keyMovement = arrowsKeysMovement[event.code];
    if (!keyMovement) return;

    editMouseMovementDirection(keyMovement, "remove")
  });

  function editMouseMovementDirection(keyMovement: Partial<Position>, op: "add" | "remove" | "set") {
    if (typeof keyMovement.x === 'number') mouseMovement.x = editOp(mouseMovement.x, keyMovement.x, op);
    if (typeof keyMovement.y === 'number') mouseMovement.y = editOp(mouseMovement.y, keyMovement.y, op);

    mouseMovement.x = Math.max(Math.min(mouseMovement.x, 1), -1);
    mouseMovement.y = Math.max(Math.min(mouseMovement.y, 1), -1);
  }

  function editOp(prevValue: number, newValue: number, op: "add" | "remove" | "set") {
    switch (op) {
      case "add":
        return prevValue + newValue;
      case "remove":
        return prevValue - newValue;
      case "set":
        return newValue
    }
  }

  return (
    <Show when={imageData()}>
      {imageData => {
        const liveSelect = createMemo(() => imageData().pickRegion || imageData().record || imageData().scrollCapture);
        const previewSrc = createMemo(() => `http://rosemyne-photo.localhost/preview/${imageData().imageId}`);
        const hintMonitor = createMemo(() =>
          getDimensionFromPoints(imageData().mousePosition, imageData().monitorPositions) ?? imageData().monitorPositions[0]
        );
        const hintPosition = createMemo(() => ({
          left: `${hintMonitor().x + hintMonitor().width / 2}px`,
          top: `${hintMonitor().y + 18}px`,
        }));
        const holeStyle = createMemo(() => ({
          left: `${selectedBox.x}px`, top: `${selectedBox.y}px`,
          width: `${selectedBox.width}px`, height: `${selectedBox.height}px`,
        }));

        return <div>
          <Show
            when={liveSelect()}
            fallback={
              <img
                class={styles.Frozen}
                src={previewSrc()}
                onMouseDown={e => mouseEventHandler.emit("mouseDown", e)}
                draggable="false"
              />
            }
          >
            {/* The transparent window shows the real desktop. Dim it with CSS and cut a hole at the selection. */}
            <div
              class={styles.LiveDim}
              classList={{ [styles.Clear]: hasSelection() }}
              onMouseDown={e => mouseEventHandler.emit("mouseDown", e)}
            />
            <Show when={hasSelection()}>
              <div class={styles.LiveHole} style={holeStyle()} />
            </Show>
          </Show>
          <SelectionBox />
          <Show when={!liveSelect()}>
            <AnnotationContext.Provider value={useScreenshotOverlayStateInner}>
              <div class={styles.AnnotationLayer}>
                <ImageOverlayContainer />
                <DrawLayer />
              </div>
              <ToolBox />
            </AnnotationContext.Provider>
          </Show>
          <Show when={imageData().record || imageData().scrollCapture}>
            <div class={styles.HintStack} style={hintPosition()}>
              <div class={styles.HintPill}>
                <span class={styles.ModePill} classList={{ [styles.Rec]: !!imageData().record }}>
                  <span class={styles.ModeDot} />
                  {imageData().scrollCapture ? "Scrolling capture" : "Record"}
                </span>
                <span>
                  {imageData().scrollCapture ? "Drag or click a scrollable region" : "Drag or click a window to record"}
                </span>
                <span class={styles.Keys}><kbd>Esc</kbd> to cancel</span>
              </div>
              <Show when={imageData().scrollCapture}>
                <ScrollCaptureLiveParams />
              </Show>
            </div>
          </Show>
        </div>;
      }}
    </Show>
  );
}

export default Screenshot;
