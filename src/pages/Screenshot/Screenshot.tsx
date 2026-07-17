import { createEffect, onCleanup, onMount, Show } from "solid-js";
import { Event as TauriEvent } from "@tauri-apps/api/event";
import { Data } from "../../types/screenshot";
import useScreenshotOverlayStateInner from "../../states/screenshotOverlayState";
import ImageOverlayContainer from "./ImageOverlayContainer/ImageOverlayContainer";
import DrawLayer from "./DrawLayer/DrawLayer";
import ToolBox from "./ToolBox/ToolBox";
import SelectionBox from "./SelectionBox/SelectionBox";
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
  const { imageData, setImageData, cancelCurrentAction, mouseEventHandler, selectedBox } = useScreenshotOverlayStateInner;
  const mouseMovement = { x: 0, y: 0 };
  let movementTimer: ReturnType<typeof setTimeout> | undefined;
  let movementInterval = MOVE_START_INTERVAL_MS;
  const hasSelection = () => selectedBox.width > 5 && selectedBox.height > 5;

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
  // diagonal) and fires at a fixed OS rate from the start , this instead
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
      setImageData(event.payload);
    });
  })

  // Right-click cancels the current action, same as Escape, regardless of
  // what's under the cursor (background, a window box, mid-drag, ...).
  makeEventListener(window, "contextmenu", event => {
    if (!imageData()) return;
    event.preventDefault();
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

  return (<>
    <Show when={imageData()}>
      {imageData => {
        const liveSelect = () => imageData().pickRegion || imageData().record;

        return <>
          <Show
            when={liveSelect()}
            fallback={
              <img
                src={`http://rosemyne-photo.localhost/preview/${imageData().imageId}`}
                style={{ filter: 'brightness(70%)', 'user-select': 'none' }}
                onMouseDown={e => mouseEventHandler.emit("mouseDown", e)}
                draggable="false"
              />
            }
          >
            {/* Transparent window shows the real desktop; dim it with CSS and
                cut a bright hole at the selection via a large box-shadow. */}
            <div
              style={{
                position: 'fixed', inset: '0',
                'background-color': hasSelection() ? 'transparent' : 'rgba(0, 0, 0, 0.3)',
              }}
              onMouseDown={e => mouseEventHandler.emit("mouseDown", e)}
            />
            <Show when={hasSelection()}>
              <div
                style={{
                  position: 'fixed', 'pointer-events': 'none',
                  left: `${selectedBox.x}px`, top: `${selectedBox.y}px`,
                  width: `${selectedBox.width}px`, height: `${selectedBox.height}px`,
                  'box-shadow': '0 0 0 100vmax rgba(0, 0, 0, 0.3)',
                }}
              />
            </Show>
          </Show>
          <SelectionBox />
          <Show when={!liveSelect()}>
            <ImageOverlayContainer />
            <DrawLayer />
            <ToolBox />
          </Show>
          <Show when={imageData().record}>
            {(() => {
              const monitor = getDimensionFromPoints(imageData().mousePosition, imageData().monitorPositions) ?? imageData().monitorPositions[0];
              return <div style={{
                position: "fixed",
                left: `${monitor.x + monitor.width / 2}px`,
                top: `${monitor.y + 16}px`,
                transform: "translateX(-50%)",
                padding: "6px 14px",
                "border-radius": "8px",
                background: "rgba(20, 20, 24, 0.85)",
                color: "#eee",
                "font-size": "13px",
                "pointer-events": "none",
              }}>
                Drag or click a window to record · Esc to cancel
              </div>;
            })()}
          </Show>
        </>
      }}
    </Show>
  </>);
}

export default Screenshot;
