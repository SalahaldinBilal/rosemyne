import { createEffect, createMemo, For, onCleanup, onMount } from "solid-js";
import { createMutable } from "solid-js/store";
import { ImageOverlay } from "../../../types/imageOverlay";
import { DragDropProvider, DragDropSensors, DragOverlay } from "@thisbeyond/solid-dnd";
import ImageOverlayElem from "./ImageOverlayElem/ImageOverlayElem";
import { useAnnotationState } from "../../../states/annotationContext";
import useOverlayDefaultsState from "../../../states/overlayDefaultsState";
import { Dimensions, Position } from "../../../types";
import { OVERLAY_TOOLS, TOOL_TO_OVERLAY } from "../../../constants";
import { getIntersection } from "../../../helpers";

const HIDDEN_BEHIND_COVERAGE = 0.9;

// A plain click (no meaningful drag) creates no item at all, rather than one so
// small it's nearly invisible; measured in screen pixels so it feels the same
// regardless of zoom.
const MIN_DRAG_DISTANCE = 4;

function ImageOverlayContainer() {
  const { overlayItems, setOverlayItems, addOverlayItem, mouseEventHandler, currentTool, setIsOverlayInteracting, toImageCoords, toImageDelta } = useAnnotationState();
  const { defaultAttributesFor } = useOverlayDefaultsState;
  const transform = createMutable({ x: 0, y: 0 });
  let mouseDownLocation: Position;
  let mouseDownScreenPoint: Position;
  let currentItemIndex = -1;

  // An item almost entirely covered by something stacked above it would otherwise
  // be impossible to grab. Only its resize border/handles get lifted (see
  // ImageOverlayBase's handlesOnTop), never its painted content: stacking of the
  // pixels themselves must stay strict creation order, since renderFinalImage
  // composites in exactly that order and preview/save have to agree.
  const hiddenBehindOthers = createMemo(() => overlayItems.map((item, index) => {
    const ownArea = item.dimensions.width * item.dimensions.height;
    if (ownArea <= 0) return false;

    return overlayItems.some((other, otherIndex) => {
      // A draw layer's dims always span the whole capture, so bounding-box
      // coverage against it is meaningless, it's mostly transparent, not a
      // solid occluder like a box/text/effect region actually is.
      if (otherIndex === index || other.order <= item.order || other.type === "draw") return false;

      const intersection = getIntersection(item.dimensions, other.dimensions);
      if (!intersection) return false;

      return (intersection.width * intersection.height) / ownArea >= HIDDEN_BEHIND_COVERAGE;
    });
  }));

  // The transient drag ghost sits just above every committed overlay; it's not a
  // committed item itself, so this never affects what gets saved.
  const dragGhostZIndex = createMemo(() =>
    30002 + overlayItems.reduce((max, item) => Math.max(max, item.order), 0),
  );

  onMount(() => {
    mouseEventHandler.on("mouseDown", mouseDownHandler);
    mouseEventHandler.on("cancelDrag", handleCancelDrag);
  })

  onCleanup(() => {
    cleanup();
    mouseEventHandler.off("mouseDown", mouseDownHandler);
    mouseEventHandler.off("cancelDrag", handleCancelDrag);
  })

  // Right-click/Escape cancelling (see `cancelCurrentAction`) while a tool is
  // mid-drag creating a new overlay item, drop that item instead of leaving
  // a stray zero/partial-size box, text, blur or pixelate region behind.
  function handleCancelDrag() {
    if (currentItemIndex !== -1) {
      setOverlayItems(overlayItems.filter((_, index) => index !== currentItemIndex));
    }
    cleanup();
  }

  createEffect(() => {
    if (OVERLAY_TOOLS.some(tool => tool === currentTool())) return;
    cleanup();
  })

  function mouseDownHandler(event: MouseEvent) {
    if (!OVERLAY_TOOLS.some(tool => tool === currentTool()) || event.button !== 0) return;
    mouseDownLocation = toImageCoords(event.clientX, event.clientY);
    mouseDownScreenPoint = { x: event.clientX, y: event.clientY };
    window.addEventListener("mouseup", mouseUpHandler);
    window.addEventListener("mousemove", mouseMoveHandler);
    // currentItemIndex stays -1 (no item yet) until the drag clears MIN_DRAG_DISTANCE.
  }

  function mouseMoveHandler(event: MouseEvent) {
    if (currentItemIndex === -1) {
      const dx = event.clientX - mouseDownScreenPoint.x;
      const dy = event.clientY - mouseDownScreenPoint.y;
      if (Math.hypot(dx, dy) < MIN_DRAG_DISTANCE) return;

      const overlayType = TOOL_TO_OVERLAY[currentTool() as keyof typeof TOOL_TO_OVERLAY];
      const defaultAttributes = defaultAttributesFor(overlayType);

      const overlay: Omit<ImageOverlay, "order"> = {
        type: overlayType,
        attributes: defaultAttributes,
        dimensions: {
          x: mouseDownLocation.x,
          y: mouseDownLocation.y,
          width: 0,
          height: 0
        }
      }

      currentItemIndex = addOverlayItem(overlay);
      setIsOverlayInteracting(true);
    }

    if (!overlayItems[currentItemIndex]) return;

    const point = toImageCoords(event.clientX, event.clientY);

    setOverlayItems(currentItemIndex, "dimensions", {
      x: point.x < mouseDownLocation.x ? point.x : mouseDownLocation.x,
      y: point.y < mouseDownLocation.y ? point.y : mouseDownLocation.y,
      width: Math.abs(point.x - mouseDownLocation.x),
      height: Math.abs(point.y - mouseDownLocation.y)
    })
  }


  function mouseUpHandler() {
    cleanup();
  }

  function cleanup() {
    window.removeEventListener("mouseup", mouseUpHandler);
    window.removeEventListener("mousemove", mouseMoveHandler);
    if (currentItemIndex !== -1) setIsOverlayInteracting(false);
    currentItemIndex = -1;
  }

  return (
    <DragDropProvider
      onDragStart={() => setIsOverlayInteracting(true)}
      onDragMove={({ overlay }) => {
        if (overlay) {
          // solid-dnd tracks raw screen-pixel pointer movement; converting it
          // here means every downstream read of `transform` is already in
          // image space, matching the native-pixel `dimensions` it's added to.
          const delta = toImageDelta(overlay.transform.x, overlay.transform.y);
          transform.x = delta.x;
          transform.y = delta.y;
        }
      }}
      onDragEnd={({ draggable }) => {
        const prevDimensions: Dimensions = draggable.data.item.dimensions;
        setOverlayItems(draggable.id as number, "dimensions", { x: transform.x + prevDimensions.x, y: transform.y + prevDimensions.y });
        transform.x = 0;
        transform.y = 0;
        setIsOverlayInteracting(false);
      }}
    >
      <DragDropSensors>
        <For each={overlayItems}>
          {
            //@ts-expect-error
            (item, index) => <ImageOverlayElem index={index()} item={item} handlesOnTop={hiddenBehindOthers()[index()]} onChange={(...args: any[]) => setItems(index(), ...args)} />
          }
        </For>
      </DragDropSensors>
      <DragOverlay style={{ "z-index": dragGhostZIndex() }}>{draggable => {
        const item = createMemo(() => ({
          ...draggable!.data!.item,
          dimensions: {
            ...draggable!.data!.item.dimensions,
            x: transform.x + draggable!.data!.item.dimensions.x,
            y: transform.y + draggable!.data!.item.dimensions.y,
          }
        }))

        return <ImageOverlayElem index={100} item={item()} beingDragged />
      }}</DragOverlay>
    </DragDropProvider>
  );
}

export default ImageOverlayContainer;