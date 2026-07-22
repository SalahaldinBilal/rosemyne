import { createMemo } from "solid-js";
import styles from "./WindowSelectionBox.module.scss";
import { DimensionsWithOrder, WindowInfo } from "../../../../types/screenshot";
import useScreenshotOverlayStateInner from "../../../../states/screenshotOverlayState";

function WindowSelectionBox(props: { window: WindowInfo, onMouseDown: (event: MouseEvent) => any, overloadPosition?: DimensionsWithOrder, disabled?: boolean, hasMovedOnce?: boolean }) {
  const { imageData, closeOverlay, consumeSuppressedClick } = useScreenshotOverlayStateInner;
  const dimensions = createMemo(() => props.overloadPosition ?? props.window.dimensions)
  const disabled = createMemo(() => props.disabled ?? false)
  const position = createMemo(() => {
    const box = dimensions();

    return {
      "z-index": box.zOrder, left: box.x.toString() + "px", top: box.y.toString() + "px",
      width: box.width.toString() + "px", height: box.height.toString() + "px",
    }
  })

  return (
    <div
      class={styles.WindowBox}
      classList={{ [styles.Disabled]: disabled() }}
      style={position()}
      onMouseDown={props.onMouseDown}
      onClick={() => {
        // A just-cancelled drag/selection still has a pending mouseup, which
        // fires a trailing click here , don't let it confirm-select.
        if (consumeSuppressedClick() || props.hasMovedOnce) return;

        closeOverlay(imageData()!.imageId);
      }}
    />
  );
}

export default WindowSelectionBox;
