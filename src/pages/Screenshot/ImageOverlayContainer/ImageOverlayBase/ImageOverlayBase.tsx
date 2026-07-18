import { createMemo, JSX } from "solid-js";
import styles from "./ImageOverlayBase.module.scss";
import { ImageOverlay } from "../../../../types/imageOverlay";
import { createDraggable } from "@thisbeyond/solid-dnd";
import ResizableBox from "../../../../components/ResizableBox/ResizableBox";
import useScreenshotOverlayStateInner from "../../../../states/screenshotOverlayState";
import { Dimensions, Tools } from "../../../../types";
import { useContextMenu } from "../../../../components/ContextMenu/useContextMenu";
import { beautifyCamelOrPascalCase } from "../../../../helpers";
import ContextMenu from "@core/components/ContextMenu/ContextMenu";
import { OVERLAY_TO_TOOL } from "../../../../constants";
import ContextMenuItem from "@core/components/ContextMenu/ContextMenuItem/ContextMenuItem";
import { CircleX } from "lucide-solid";
import OverlayAttributeList from "@core/components/OverlayAttributeList/OverlayAttributeList";

function ImageOverlayBase(props: { index: number, item: ImageOverlay, beingDragged?: boolean, renderOrder?: number, children: JSX.Element }) {
  const { overlayItems, setOverlayItems, currentTool, setIsOverlayInteracting } = useScreenshotOverlayStateInner;
  const { show: showContextMenu, id: menuId } = useContextMenu();
  const draggable = createDraggable(props.index, { item: props.item });
  const isBeingDragged = createMemo(() => draggable.isActiveDraggable);
  // Not every overlay type has a box-creation tool (the freehand draw layer
  // doesn't, see DrawLayer.tsx), so the lookup can legitimately miss.
  const ownTool = (OVERLAY_TO_TOOL as Partial<Record<ImageOverlay["type"], Tools>>)[props.item.type];
  const canBeEdited = createMemo(() => currentTool() === ownTool || currentTool() === Tools.Move)
  const style = createMemo(() => {
    const dims = props.item.dimensions;

    return {
      left: (props.beingDragged ? 0 : dims.x.toString()) + "px", top: (props.beingDragged ? 0 : dims.y.toString()) + "px",
      width: dims.width.toString() + "px", height: dims.height.toString() + "px",
      'z-index': 30001 + (props.renderOrder ?? props.item.order)
    }
  })

  function onDimsChange(dims: Dimensions) {
    setOverlayItems(props.index, "dimensions", dims);
  }

  function editAttribute(name: string, value: any) {
    setOverlayItems(props.index, "attributes", name as never, "value" as never, value);
  }

  return <>
    <ResizableBox
      borderWidth={3}
      pointRadius={18}
      onResize={(dims) => !isBeingDragged() && onDimsChange(dims)}
      onResizeStart={() => setIsOverlayInteracting(true)}
      onResizeEnd={() => setIsOverlayInteracting(false)}
      show={canBeEdited() && !isBeingDragged()}
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
            // Without this, the window-level contextmenu listener in
            // Screenshot.tsx (right-click = cancel/close) also sees this
            // event and closes the overlay right after opening the menu.
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
      <ContextMenuItem icon={{ icon: CircleX }} danger onClick={() => setOverlayItems(overlayItems.filter((_, index) => index !== props.index))}>
        Remove Overlay
      </ContextMenuItem>
    </ContextMenu>
  </>;
}

export default ImageOverlayBase;