import styles from "./ResizableBox.module.scss";
import { Dimensions, ResizeDirection } from "../../types";
import { createEffect, createMemo, createSignal, For, JSX, onCleanup, Setter, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { dimensionToStyle } from "../../helpers";
import { createMutationObserver } from "@solid-primitives/mutation-observer";
import ResizePoint, { composeDirection, directionCursor, horizontalAnchor, verticalAnchor } from "./ResizePoint/ResizePoint";

function ResizableBox(props: { children: (ref: Setter<HTMLDivElement | undefined>) => JSX.Element, onResize: (dims: Dimensions) => any, onResizeStart?: () => void, onResizeEnd?: () => void, show?: boolean, borderWidth?: number, style?: Omit<JSX.CSSProperties, "border" | "border-width">, pointRadius?: number }): JSX.Element {
  const [elementRef, setElementRef] = createSignal<HTMLDivElement>();
  const [zIndex, setZIndex] = createSignal<number>(0);
  const [boxPosition, setBoxPosition] = createStore<Dimensions>({ x: 0, y: 0, width: 0, height: 0 });
  const shouldShow = createMemo(() => !!props.show && !!elementRef());
  const borderWidth = createMemo(() => props.borderWidth ?? 5);
  const style = createMemo<JSX.CSSProperties>(() => ({ 'border-width': borderWidth() + 'px', ...(props.style ?? {}), ...dimensionToStyle(boxPosition), 'z-index': zIndex() }));
  const pointRadius = createMemo(() => {
    const desiredRadius = props.pointRadius ?? 25;
    // Each point sits in one of 3 equal rows/columns; keep a full cell of slack (desiredRadius)
    // between the point and the cell edge so it vanishes well before neighboring points could overlap.
    const cellSize = Math.min(boxPosition.width, boxPosition.height) / 3;
    return Math.max(0, Math.min(desiredRadius, cellSize - desiredRadius));
  });

  // Fixed opposite edge/corner for the active drag; stays valid even after the dragged corner flips past it.
  let anchor: { x: number | null, y: number | null } = { x: null, y: null };
  let draggedDirection: ResizeDirection | null = null;

  createMutationObserver(() => elementRef() ? [elementRef()!] : [], { attributes: true }, records => {
    updateBoxAndZIndex(records[0].target)
  });

  createEffect(() => updateBoxAndZIndex(elementRef()))

  onCleanup(() => stopDrag());

  function updateBoxAndZIndex(element: Node | undefined | null) {
    if (!(element instanceof HTMLElement) || !shouldShow()) return;

    setZIndex(+window.getComputedStyle(element).zIndex || 0)

    const boundingBox = element.getBoundingClientRect();

    setBoxPosition({
      x: boundingBox.x - borderWidth(),
      y: boundingBox.y - borderWidth(),
      width: boundingBox.width + (borderWidth() * 2),
      height: boundingBox.height + (borderWidth() * 2)
    })
  }

  function onDimsUpdate(dims: Dimensions) {
    setBoxPosition(dims);
    props.onResize({
      width: Math.max(dims.width - (borderWidth() * 2), 0),
      height: Math.max(dims.height - (borderWidth() * 2), 0),
      x: dims.x + borderWidth(),
      y: dims.y + borderWidth(),
    });
  }

  function startDrag(direction: ResizeDirection) {
    anchor = {
      x: horizontalAnchor(direction, boxPosition),
      y: verticalAnchor(direction, boxPosition),
    };
    draggedDirection = direction;
    document.body.style.cursor = directionCursor(direction);
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", stopDrag);
    props.onResizeStart?.();
  }

  function onDragMove(event: MouseEvent) {
    const newDims: Dimensions = { x: boxPosition.x, y: boxPosition.y, width: boxPosition.width, height: boxPosition.height };
    let horizontalSide: "left" | "right" | null = null;
    let verticalSide: "top" | "bottom" | null = null;

    if (anchor.x !== null) {
      newDims.x = Math.min(event.clientX, anchor.x);
      newDims.width = Math.abs(event.clientX - anchor.x);
      horizontalSide = event.clientX < anchor.x ? "left" : "right";
    }

    if (anchor.y !== null) {
      newDims.y = Math.min(event.clientY, anchor.y);
      newDims.height = Math.abs(event.clientY - anchor.y);
      verticalSide = event.clientY < anchor.y ? "top" : "bottom";
    }

    const currentDirection = composeDirection(horizontalSide, verticalSide) ?? draggedDirection;
    if (currentDirection !== null && currentDirection !== draggedDirection) {
      draggedDirection = currentDirection;
      document.body.style.cursor = directionCursor(currentDirection);
    }

    onDimsUpdate(newDims);
  }

  function stopDrag() {
    const wasDragging = draggedDirection !== null;
    anchor = { x: null, y: null };
    draggedDirection = null;
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", stopDrag);
    if (wasDragging) props.onResizeEnd?.();
  }

  return (
    <>
      {props.children(setElementRef)}
      <Show when={shouldShow()}>
        <div class={styles.ResizeBox} style={style()}>
          <div style={{ "grid-area": '2 / 2 / 2 / 2' }}></div>
          <For each={Object.values(ResizeDirection).filter(e => typeof e === "number")}>
            {direction => <ResizePoint direction={direction} pointRadius={pointRadius()} onMouseDown={() => startDrag(direction)} />}
          </For>
        </div>
      </Show>
    </>
  );
}

export default ResizableBox;