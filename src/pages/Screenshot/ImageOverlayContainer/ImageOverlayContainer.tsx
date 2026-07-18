import { createEffect, createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import { createMutable } from "solid-js/store";
import { ImageOverlay } from "../../../types/imageOverlay";
import { DragDropProvider, DragDropSensors, DragOverlay } from "@thisbeyond/solid-dnd";
import ImageOverlayElem from "./ImageOverlayElem/ImageOverlayElem";
import useScreenshotOverlayStateInner from "../../../states/screenshotOverlayState";
import useOverlayDefaultsState from "../../../states/overlayDefaultsState";
import { Dimensions } from "../../../types";
import { OVERLAY_TOOLS, TOOL_TO_OVERLAY } from "../../../constants";
import { getIntersection } from "../../../helpers";

// Large enough to always outrank any realistic item.order, so a nearly-fully-covered
// item still renders above whatever is covering it instead of staying invisible.
const HIDDEN_BEHIND_BOOST = 100_000;
const HIDDEN_BEHIND_COVERAGE = 0.9;

function ImageOverlayContainer() {
  const { overlayItems, setOverlayItems, addOverlayItem, mouseEventHandler, currentTool, setIsOverlayInteracting } = useScreenshotOverlayStateInner;
  const { defaultAttributesFor } = useOverlayDefaultsState;
  const transform = createMutable({ x: 0, y: 0 });
  const [draggedItemIndex, setDraggedItemIndex] = createSignal<number | null>(null);
  let mouseDownLocation: MouseEvent;
  let currentItemIndex = -1;

  // An item that's almost entirely covered by something stacked above it renders on top
  // instead, so it's never left completely hidden.
  const renderOrders = createMemo(() => overlayItems.map((item, index) => {
    const ownArea = item.dimensions.width * item.dimensions.height;
    if (ownArea <= 0) return item.order;

    const isHiddenBehindOthers = overlayItems.some((other, otherIndex) => {
      // A draw layer's dims always span the whole capture, so bounding-box
      // coverage against it is meaningless , it's mostly transparent, not a
      // solid occluder like a box/text/effect region actually is.
      if (otherIndex === index || other.order <= item.order || other.type === "draw") return false;

      const intersection = getIntersection(item.dimensions, other.dimensions);
      if (!intersection) return false;

      return (intersection.width * intersection.height) / ownArea >= HIDDEN_BEHIND_COVERAGE;
    });

    return isHiddenBehindOthers ? item.order + HIDDEN_BEHIND_BOOST : item.order;
  }));

  // Same protection for the item actively being dragged, but checked against its live
  // (transform-adjusted) position instead of the stale committed dimensions, and against
  // every other item regardless of order, since the dragged item is always meant to stay on top.
  const draggedItemZIndex = createMemo(() => {
    const index = draggedItemIndex();
    if (index === null) return null;

    const item = overlayItems[index];
    if (!item) return null;

    const liveDimensions: Dimensions = {
      x: item.dimensions.x + transform.x,
      y: item.dimensions.y + transform.y,
      width: item.dimensions.width,
      height: item.dimensions.height,
    };
    const ownArea = liveDimensions.width * liveDimensions.height;

    const isHiddenBehindOthers = ownArea > 0 && overlayItems.some((other, otherIndex) => {
      if (otherIndex === index || other.type === "draw") return false;

      const intersection = getIntersection(liveDimensions, other.dimensions);
      if (!intersection) return false;

      return (intersection.width * intersection.height) / ownArea >= HIDDEN_BEHIND_COVERAGE;
    });

    return 30001 + item.order + (isHiddenBehindOthers ? HIDDEN_BEHIND_BOOST : 0);
  });

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
  // mid-drag creating a new overlay item , drop that item instead of leaving
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
    mouseDownLocation = event;
    window.addEventListener("mouseup", mouseUpHandler);
    window.addEventListener("mousemove", mouseMoveHandler);

    const overlayType = TOOL_TO_OVERLAY[currentTool() as keyof typeof TOOL_TO_OVERLAY];
    const defaultAttributes = defaultAttributesFor(overlayType);

    const overlay: Omit<ImageOverlay, "order"> = {
      type: overlayType,
      attributes: defaultAttributes,
      dimensions: {
        x: event.x,
        y: event.y,
        width: 0,
        height: 0
      }
    }

    currentItemIndex = addOverlayItem(overlay);
    setIsOverlayInteracting(true);
  }

  function mouseMoveHandler(event: MouseEvent) {
    if (!overlayItems[currentItemIndex]) return;

    setOverlayItems(currentItemIndex, "dimensions", {
      x: event.clientX < mouseDownLocation.x ? event.clientX : mouseDownLocation.x,
      y: event.clientY < mouseDownLocation.y ? event.clientY : mouseDownLocation.y,
      width: Math.abs(event.clientX - mouseDownLocation.x),
      height: Math.abs(event.clientY - mouseDownLocation.y)
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
      onDragStart={({ draggable }) => {
        setIsOverlayInteracting(true);
        setDraggedItemIndex(draggable.id as number);
      }}
      onDragMove={({ overlay }) => {
        if (overlay) {
          transform.x = overlay.transform.x;
          transform.y = overlay.transform.y;
        }
      }}
      onDragEnd={({ draggable }) => {
        const prevDimensions: Dimensions = draggable.data.item.dimensions;
        setOverlayItems(draggable.id as number, "dimensions", { x: transform.x + prevDimensions.x, y: transform.y + prevDimensions.y });
        transform.x = 0;
        transform.y = 0;
        setIsOverlayInteracting(false);
        setDraggedItemIndex(null);
      }}
    >
      <DragDropSensors>
        <For each={overlayItems}>
          {
            //@ts-expect-error
            (item, index) => <ImageOverlayElem index={index()} item={item} renderOrder={renderOrders()[index()]} onChange={(...args: any[]) => setItems(index(), ...args)} />
          }
        </For>
      </DragDropSensors>
      <DragOverlay style={{ "z-index": draggedItemZIndex() ?? undefined }}>{draggable => {
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