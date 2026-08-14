import { createMemo, JSX } from "solid-js";
import styles from "./ImageOverlayBase.module.scss";
import { ImageOverlay } from "../../../../types/imageOverlay";
import { createDraggable } from "@thisbeyond/solid-dnd";
import ResizableBox from "../../../../components/ResizableBox/ResizableBox";
import { useAnnotationState } from "../../../../states/annotationContext";
import { Dimensions, Tools } from "../../../../types";
import { useContextMenu } from "../../../../components/ContextMenu/useContextMenu";
import { beautifyCamelOrPascalCase, lineEndpoints, nearestLineCorner } from "../../../../helpers";
import ContextMenu from "@core/components/ContextMenu/ContextMenu";
import { OVERLAY_TO_TOOL } from "../../../../constants";
import ContextMenuItem from "@core/components/ContextMenu/ContextMenuItem/ContextMenuItem";
import { CircleX } from "lucide-solid";
import OverlayAttributeList from "@core/components/OverlayAttributeList/OverlayAttributeList";

// Large enough to always outrank any realistic item.order.
const HANDLES_ON_TOP_BOOST = 100_000;

function ImageOverlayBase(props: { index: number, item: ImageOverlay, beingDragged?: boolean, handlesOnTop?: boolean, children: JSX.Element }) {
  const { overlayItems, setOverlayItems, currentTool, setIsOverlayInteracting, creatingItemIndex, toImageCoords, history } = useAnnotationState();
  const { show: showContextMenu, id: menuId } = useContextMenu();
  const draggable = createDraggable(props.index, { item: props.item });
  const isBeingDragged = createMemo(() => draggable.isActiveDraggable);
  // Not every overlay type has a box-creation tool (the freehand draw layer
  // doesn't, see DrawLayer.tsx), so the lookup can legitimately miss.
  const ownTool = (OVERLAY_TO_TOOL as Partial<Record<ImageOverlay["type"], Tools>>)[props.item.type];
  const canBeEdited = createMemo(() => currentTool() === ownTool || currentTool() === Tools.Move)
  const isLineType = props.item.type === "arrow" || props.item.type === "line";
  const isBeingCreated = createMemo(() => creatingItemIndex() === props.index);
  // A line/arrow's bounding-box handles look wrong around a thin diagonal stroke while it's still being dragged out.
  const suppressHandlesWhileCreating = createMemo(() => isLineType && isBeingCreated());
  const style = createMemo(() => {
    const dims = props.item.dimensions;

    return {
      left: (props.beingDragged ? 0 : dims.x.toString()) + "px", top: (props.beingDragged ? 0 : dims.y.toString()) + "px",
      width: dims.width.toString() + "px", height: dims.height.toString() + "px",
      // Strict creation order, always: renderFinalImage composites in this same
      // order, so anything else here would desync the preview from the save.
      'z-index': 30001 + props.item.order
    }
  })

  function onDimsChange(dims: Dimensions) {
    if (props.item.type === "arrow" || props.item.type === "line") {
      const { start } = lineEndpoints(props.item.dimensions, props.item.startCorner);
      setOverlayItems(props.index, { dimensions: dims, startCorner: nearestLineCorner(start, dims) } as any);
      return;
    }

    setOverlayItems(props.index, "dimensions", dims);
  }

  function editAttribute(name: string, value: any) {
    setOverlayItems(props.index, "attributes", name as never, "value" as never, value);
    history.commit(`attr:${props.index}:${name}`);
  }

  return <>
    <ResizableBox
      borderWidth={3}
      pointRadius={18}
      onResize={(dims) => !isBeingDragged() && onDimsChange(dims)}
      onResizeStart={() => setIsOverlayInteracting(true)}
      onResizeEnd={() => { setIsOverlayInteracting(false); history.commit(); }}
      show={canBeEdited() && !isBeingDragged() && !suppressHandlesWhileCreating()}
      toContainerCoords={toImageCoords}
      // Only the resize border/handles are lifted above whatever is covering this
      // item; the overlay's own pixels stay in creation order (see the style memo).
      zIndexBoost={props.handlesOnTop ? HANDLES_ON_TOP_BOOST : 0}
    >
      {ref => <>
        <div
          ref={ref}
          class={styles.ImageOverlayBase}
          classList={{ [styles.BeingDragged]: isBeingDragged(), [styles.NotEditable]: !canBeEdited() }}
          style={style()}
          use:draggable
          onContextMenu={ev => {
            ev.preventDefault();
            // Screenshot.tsx's own contextmenu listener runs in the capture
            // phase and already wins whenever there's a drag to cancel, so
            // reaching here at all means this is a right-click on an idle item.
            ev.stopPropagation();
            showContextMenu(ev);
          }}
          onDblClick={ev => {
            if (isBeingCreated()) return;

            // Same reasoning as onContextMenu: ImageViewer's own dblclick (zoom) would otherwise also fire.
            ev.stopPropagation();
            showContextMenu(ev);
          }}
        >
          {props.children}
        </div>
      </>}
    </ResizableBox>
    <ContextMenu id={menuId} styles={{ "max-height": "340px", width: "230px" }}>
      <div class={styles.MenuHeader}>{beautifyCamelOrPascalCase(props.item.type)} Overlay</div>
      <OverlayAttributeList attributes={props.item.attributes} onChange={editAttribute} />
      <div class={styles.Divider} />
      <ContextMenuItem icon={{ icon: CircleX }} danger onClick={() => {
        setOverlayItems(overlayItems.filter((_, index) => index !== props.index));
        history.commit();
      }}>
        Remove Overlay
      </ContextMenuItem>
    </ContextMenu>
  </>;
}

export default ImageOverlayBase;