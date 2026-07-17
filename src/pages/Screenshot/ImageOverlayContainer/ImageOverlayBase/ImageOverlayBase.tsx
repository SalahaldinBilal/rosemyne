import { createMemo, For, JSX, mapArray, Match, Switch } from "solid-js";
import styles from "./ImageOverlayBase.module.scss";
import { ImageOverlay, ImageOverlayNumberAttribute, ImageOverlaySelectAttribute } from "../../../../types/imageOverlay";
import Select from "../../../../components/Select/Select";
import { createDraggable } from "@thisbeyond/solid-dnd";
import ResizableBox from "../../../../components/ResizableBox/ResizableBox";
import useScreenshotOverlayStateInner from "../../../../states/screenshotOverlayState";
import { Dimensions, Tools } from "../../../../types";
import { useContextMenu } from "../../../../components/ContextMenu/useContextMenu";
import { beautifyCamelOrPascalCase } from "../../../../helpers";
import { DefaultColorPicker } from "@thednp/solid-color-picker";
import Input from "../../../../components/Input/Input";
import { unwrap } from "solid-js/store";
import ContextMenu from "@core/components/ContextMenu/ContextMenu";
import { OVERLAY_TO_TOOL } from "../../../../constants";
import ContextMenuItem from "@core/components/ContextMenu/ContextMenuItem/ContextMenuItem";
import { CircleX } from "lucide-solid";

function ImageOverlayBase(props: { index: number, item: ImageOverlay, beingDragged?: boolean, renderOrder?: number, children: JSX.Element }) {
  const { overlayItems, setOverlayItems, currentTool, setIsOverlayInteracting } = useScreenshotOverlayStateInner;
  const { show: showContextMenu, id: menuId } = useContextMenu();
  const draggable = createDraggable(props.index, { item: props.item });
  const isBeingDragged = createMemo(() => draggable.isActiveDraggable);
  // Not every overlay type has a box-creation tool (the freehand draw layer
  // doesn't, see DrawLayer.tsx), so the lookup can legitimately miss.
  const ownTool = (OVERLAY_TO_TOOL as Partial<Record<ImageOverlay["type"], Tools>>)[props.item.type];
  const canBeEdited = createMemo(() => currentTool() === ownTool || currentTool() === Tools.Move)
  const attributes = mapArray(() => Object.entries(props.item.attributes), ([name, value]) => ({ name: name, ...value }));
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
            showContextMenu(ev);
          }}
        >
          {props.children}
        </div>
      </>}
    </ResizableBox>
    <ContextMenu id={menuId} styles={{ "max-height": "340px", width: "230px" }}>
      <div class={styles.MenuHeader}>{beautifyCamelOrPascalCase(props.item.type)} Overlay</div>
      <div class={styles.AttributeList}>
        <For each={attributes()}>{attribute =>
          <div class={styles.AttributeRow} id={JSON.stringify(unwrap(attribute))}>
            <span class={styles.AttributeLabel}>{beautifyCamelOrPascalCase(attribute.name)}</span>
            <div class={styles.AttributeControl}>
              <Switch>
                <Match when={attribute.type === "color"}>
                  <div class={styles.ColorPickerWrapper}>
                    <DefaultColorPicker
                      format="hex"
                      theme="dark"
                      value={attribute.value as string}
                      onChange={color => editAttribute(attribute.name, color)}
                    />
                  </div>
                </Match>
                <Match when={attribute.type === "number"}>
                  <Input
                    type="number"
                    value={attribute.value as number}
                    onChange={e => editAttribute(attribute.name, e.currentTarget.valueAsNumber ?? 0)}
                    min={(attribute as ImageOverlayNumberAttribute).min}
                    max={(attribute as ImageOverlayNumberAttribute).max}
                    alignText="right"
                    style={{ width: "70px" }}
                    inputStyle={{ height: "26px", padding: "0 8px" }}
                  />
                </Match>
                <Match when={attribute.type === "string"}>
                  <Input
                    value={attribute.value as number}
                    onChange={e => editAttribute(attribute.name, e.currentTarget.value)}
                    style={{ width: "110px" }}
                    inputStyle={{ height: "26px", padding: "0 8px" }}
                  />
                </Match>
                <Match when={attribute.type === "select"}>
                  <Select
                    value={attribute.value as string}
                    items={(attribute as ImageOverlaySelectAttribute).options.map(option => ({ id: option, value: option, label: option }))}
                    onItemClick={item => editAttribute(attribute.name, item.value)}
                    style={{ "min-width": "110px", height: "26px", padding: "0 8px", "font-size": "12px" }}
                  />
                </Match>
              </Switch>
            </div>
          </div>
        }</For>
      </div>
      <div class={styles.Divider} />
      <ContextMenuItem icon={{ icon: CircleX }} danger onClick={() => setOverlayItems(overlayItems.filter((_, index) => index !== props.index))}>
        Remove Overlay
      </ContextMenuItem>
    </ContextMenu>
  </>;
}

export default ImageOverlayBase;